import { spawn as spawnAsync, spawnSync } from 'node:child_process';
import { lookup } from 'node:dns/promises';
import { existsSync, lstatSync, readdirSync, readlinkSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readLock } from '../lock/file';
import { cyan, gray } from '../utils/ansi';
import { rmSkillDir } from '../utils/fs-rm';
import { extractMode } from '../utils/mode';
import { createProgress, renderBar } from '../utils/progress';
import { scopeLabel } from '../utils/scope';
import { collectRows, renderSkillTable, type SkillRoots } from '../utils/skill-table';

export interface SpawnOutcome {
  status: number | null;
  error?: Error;
  stdout?: string;
  stderr?: string;
}

// onOutput: called on every captured chunk, so the caller sees when npx starts working
export type Spawner = (
  command: string,
  args: string[],
  capture: boolean,
  onOutput?: () => void,
) => SpawnOutcome | Promise<SpawnOutcome>;

export interface AddDeps {
  spawn?: Spawner;
  cwd?: string;
  home?: string;
  // resolves true once the npm registry resolves; the progress bar appears then
  online?: () => Promise<boolean>;
}

const defaultOnline = () =>
  lookup('registry.npmjs.org').then(
    () => true,
    () => false,
  );

// Node >= 20 refuses to spawn npx.cmd without a shell on Windows (EINVAL)
export const defaultSpawn: Spawner = (command, args, capture, onOutput) => {
  if (!capture) {
    const r = spawnSync(command, args, { stdio: 'inherit', shell: process.platform === 'win32' });
    return { status: r.status, error: r.error };
  }
  // async so the progress line can redraw while npx runs
  return new Promise((done) => {
    const child = spawnAsync(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    });
    let stdout = '';
    let stderr = '';
    // decode per stream so a multibyte character split across chunks stays intact
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (d) => {
      stdout += d;
      onOutput?.();
    });
    child.stderr?.on('data', (d) => {
      stderr += d;
      onOutput?.();
    });
    child.on('error', (error) => done({ status: null, error, stdout, stderr }));
    child.on('close', (status) => done({ status, stdout, stderr }));
  });
};

export const ADD_HELP = [
  'Install skills: run `npx -y skills add` with the same arguments.',
  '',
  'USAGE skl-x add <source> [OPTIONS]',
  '',
  'Every argument except -m/--mode is passed to `npx skills add` unchanged;',
  'see `npx skills add --help`. Then, as skl rm beforehand would, it removes what npx',
  'left of each added skill in the other agent dir (e.g. a skl sln link).',
  '',
  'OPTIONS',
  '',
  '  -y, --yes           Skip npx prompts (needed by sm and md)',
  '  -m, --mode          lg (large, default): the npx output, then the md output',
  '                      md (medium): a progress line, a table of the changed skills and',
  '                      a "<scope> · +N skills installed · <names>" line',
  '                      sm (small): the "<scope> · +N skills installed · <names>" line only',
  '',
  'EXAMPLES',
  '',
  '  skl add sentimony/skills -l',
  '  skl add sentimony/skills -s cross-review tdd -a codex claude-code -y',
  '  skl add sentimony/skills -s tdd -y -m md',
  '  skl add sentimony/skills -s tdd -y -m sm',
].join('\n');

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

// "Project scope · +2 skills installed · tdd vitest"; the last line of every mode
export function summaryLine(verb: string, names: string[], scope: string): string {
  if (names.length === 0) return gray(`${scope} · No skills ${verb}`);
  const count = gray(`${scope} · +${plural(names.length, 'skill')} ${verb}`);
  return `${count} ${gray('·')} ${cyan(names.join(' '))}`;
}

// "Installing 2 skills from <source> to Project scope"; without a count while the total is unknown
function installingLabel(source: string, count: number | null, scope: string): string {
  const what = count === null ? 'Installing' : `Installing ${plural(count, 'skill')}`;
  return `${source ? `${what} from ${source}` : what} to ${scope}`;
}

// One signature per skill name across both dirs and the lock; a reinstall changes the inode,
// the mtime of the entry or of SKILL.md, the link target or the lock entry. Nanosecond stats:
// ext4 reuses a freed inode at once, and a reinstall can land in the same millisecond
export function snapshotSkills(roots: SkillRoots, lockPath: string): Map<string, string> {
  const parts = new Map<string, string[]>();
  const add = (name: string, part: string) => parts.set(name, [...(parts.get(name) ?? []), part]);
  for (const [key, root] of [
    ['a', roots.agents],
    ['c', roots.claude],
  ] as const) {
    if (!existsSync(root)) continue;
    for (const name of readdirSync(root)) {
      const dir = join(root, name);
      const l = lstatSync(dir, { bigint: true });
      const link = l.isSymbolicLink() ? readlinkSync(dir) : '';
      const md = statSync(join(dir, 'SKILL.md'), { bigint: true, throwIfNoEntry: false });
      add(name, `${key}:${l.ino}:${l.mtimeNs}:${link}:${md?.mtimeNs ?? ''}`);
    }
  }
  for (const [name, entry] of Object.entries(readLock(lockPath).skills))
    add(name, `l:${JSON.stringify(entry)}`);
  return new Map([...parts].map(([name, p]) => [name, p.join('|')]));
}

// lstat only, per entry: SKILL.md behind a .claude link into .agents changes with .agents
function entrySignatures(roots: SkillRoots): Map<string, string> {
  const out = new Map<string, string>();
  for (const root of [roots.agents, roots.claude]) {
    if (!existsSync(root)) continue;
    for (const name of readdirSync(root)) {
      const dir = join(root, name);
      const l = lstatSync(dir, { bigint: true });
      out.set(dir, `${l.ino}:${l.mtimeNs}:${l.isSymbolicLink() ? readlinkSync(dir) : ''}`);
    }
  }
  return out;
}

// The skill dirs that the agents of -a write to; null without -a. Agents outside these two dirs
// are not tracked
export function agentRoots(args: string[], roots: SkillRoots): string[] | null {
  if (args.includes('--all')) return [roots.agents, roots.claude];
  const agents: string[] = [];
  args.forEach((t, i) => {
    if (t !== '-a' && t !== '--agent') return;
    for (const a of args.slice(i + 1)) {
      if (a.startsWith('-')) break;
      agents.push(a);
    }
  });
  if (agents.length === 0) return null;
  if (agents.includes('*')) return [roots.agents, roots.claude];
  return [
    ...(agents.includes('codex') ? [roots.agents] : []),
    ...(agents.includes('claude-code') ? [roots.claude] : []),
  ];
}

function realOrNull(p: string): string | null {
  try {
    return realpathSync(p);
  } catch {
    return null;
  }
}

// npx rewrites a skill only in the dirs of -a, and leaves an entry there that is already right
// (on a rerun, the .claude link into .agents). An entry of an installed skill that npx left as it
// was outside -a (a skl sln link, a copy for another agent) is removed, as skl rm before the
// install would; without -a, unless it resolves to the skill's entry in the other dir. After the
// install, not before: a failed or skipped install keeps the old skill. Returns the skills missing
// for an agent of -a
function removeLeftovers(
  scope: AddScope,
  before: Map<string, string>,
  installed: string[],
  owned: string[] | null,
): string[] {
  const now = entrySignatures(scope.roots);
  const both = [scope.roots.agents, scope.roots.claude];
  for (const name of installed) {
    for (const root of both) {
      const dir = join(root, name);
      const was = before.get(dir);
      if (was === undefined || now.get(dir) !== was) continue;
      if (owned !== null && owned.includes(root)) continue;
      const other = join(both.find((r) => r !== root) ?? root, name);
      const real = realOrNull(dir);
      if (owned === null && real !== null && real === realOrNull(other)) continue;
      rmSkillDir(dir, { allowedRoots: [scope.base] });
    }
  }
  const missing: string[] = [];
  for (const name of installed) {
    for (const root of owned ?? []) {
      if (lstatSync(join(root, name), { throwIfNoEntry: false })) continue;
      const label = root === scope.roots.claude ? '.claude/skills' : '.agents/skills';
      missing.push(`skl add: ${name} is missing in ${label}`);
    }
  }
  return missing;
}

// prints each missing entry; true when there was one
function reportMissing(missing: string[]): boolean {
  for (const m of missing) console.error(m);
  return missing.length > 0;
}

// `owner/repo` is the GitHub shorthand of `npx skills add`; URLs, paths and deeper paths stay as given
export function sourceLabel(first: string | undefined): string {
  if (first === undefined || first.startsWith('-')) return '';
  return /^[A-Za-z0-9_-][\w.-]*\/[\w.-]+$/.test(first) ? `https://github.com/${first}` : first;
}

// names after -s/--skill up to the next flag; '*' asks for every skill, so there is no total
export function requestedSkills(args: string[]): string[] | null {
  const names: string[] = [];
  args.forEach((t, i) => {
    if (t !== '-s' && t !== '--skill') return;
    for (const n of args.slice(i + 1)) {
      if (n.startsWith('-')) break;
      names.push(n);
    }
  });
  return names.length === 0 || names.includes('*') ? null : [...new Set(names)];
}

interface AddScope {
  base: string;
  label: string;
  roots: SkillRoots;
  lockPath: string;
  lockLabel: string;
}

// npx skills add writes to the home dirs with -g, to the current directory otherwise
function addScope(args: string[], deps: AddDeps): AddScope {
  const isGlobal = args.includes('-g') || args.includes('--global');
  const home = deps.home ?? homedir();
  const base = isGlobal ? home : (deps.cwd ?? process.cwd());
  return {
    base,
    label: scopeLabel(isGlobal),
    roots: { agents: join(base, '.agents', 'skills'), claude: join(base, '.claude', 'skills') },
    lockPath: isGlobal ? join(home, '.agents', '.skill-lock.json') : join(base, 'skills-lock.json'),
    lockLabel: isGlobal ? '.agents/.skill-lock.json' : 'skills-lock.json',
  };
}

function changedSince(scope: AddScope, before: Map<string, string>): string[] {
  const now = snapshotSkills(scope.roots, scope.lockPath);
  return [...now.keys()].filter((name) => now.get(name) !== before.get(name));
}

function printTable(scope: AddScope, changed: string[]): void {
  if (changed.length === 0) return;
  const lockNames = new Set(Object.keys(readLock(scope.lockPath).skills));
  const rows = collectRows(changed, scope.roots, lockNames);
  for (const line of renderSkillTable(rows, { lockLabel: scope.lockLabel, total: false }))
    console.log(line);
}

function failedToRun(r: SpawnOutcome): boolean {
  if (!r.error && r.status !== null) return false;
  console.error(`skl add: failed to run npx${r.error ? `: ${r.error.message}` : ''}`);
  return true;
}

// a captured run shows what npx printed only when it fails
function reportCapturedFailure(r: SpawnOutcome): number {
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  return failedToRun(r) ? 1 : (r.status ?? 1);
}

// cells after the progress intro: the eighth once npx prints anything, the ninth when every
// requested skill has changed; the tenth is only drawn by done()
const STARTED = 1 / 3;

async function runMd(
  args: string[],
  spawn: Spawner,
  scope: AddScope,
  online: () => Promise<boolean>,
): Promise<number> {
  const from = sourceLabel(args[0]);
  const requested = requestedSkills(args);
  const progress = createProgress(installingLabel(from, requested?.length ?? null, scope.label));
  const before = snapshotSkills(scope.roots, scope.lockPath);
  const entries = entrySignatures(scope.roots);
  let started = false;
  const tick = () => {
    if (!started) return;
    if (requested === null) return progress.update(STARTED);
    // npx may remove an entry between readdir and lstat; skip that frame
    try {
      const changed = new Set(changedSince(scope, before));
      const done = requested.filter((n) => changed.has(n)).length;
      progress.update(Math.min(0.99, STARTED + ((1 - STARTED) * done) / requested.length));
    } catch {}
  };
  // a finished run must not wait for the lookup
  let finished = false;
  if (process.stdout.isTTY)
    void online().then((ok) => {
      if (ok && !finished) progress.start();
    });
  const onOutput = () => {
    if (started) return;
    started = true;
    // offline npx can still run from its cache; its first output shows the bar too
    progress.start();
    tick();
  };
  const timer = setInterval(tick, 100);
  let r: SpawnOutcome;
  try {
    r = await spawn('npx', ['-y', 'skills', 'add', ...args], true, onOutput);
  } finally {
    finished = true;
    clearInterval(timer);
  }
  if (r.error || r.status === null || r.status !== 0) {
    progress.fail();
    return reportCapturedFailure(r);
  }
  const changed = changedSince(scope, before);
  if (reportMissing(removeLeftovers(scope, entries, changed, agentRoots(args, scope.roots)))) {
    progress.fail();
    return 1;
  }
  await progress.done(installingLabel(from, requested?.length ?? changed.length, scope.label));
  printTable(scope, changed);
  console.log(summaryLine('installed', changed, scope.label));
  return 0;
}

async function runLg(args: string[], spawn: Spawner, scope: AddScope): Promise<number> {
  // the table is extra on top of the npx proxy: a broken lock or skill dir must not stop
  // npx from running or turn its success into a crash, so it only drops the md output
  let before: Map<string, string> | null = null;
  let entries = new Map<string, string>();
  try {
    before = snapshotSkills(scope.roots, scope.lockPath);
    entries = entrySignatures(scope.roots);
  } catch {}
  const r = await spawn('npx', ['-y', 'skills', 'add', ...args], false);
  if (failedToRun(r)) return 1;
  if (r.status !== 0) return r.status ?? 1;
  if (before === null) return 0;
  try {
    const changed = changedSince(scope, before);
    if (reportMissing(removeLeftovers(scope, entries, changed, agentRoots(args, scope.roots))))
      return 1;
    // e.g. -l: nothing installed, the npx output is all there is to show
    if (changed.length === 0) return 0;
    const requested = requestedSkills(args);
    const from = sourceLabel(args[0]);
    console.log(
      `${gray(installingLabel(from, requested?.length ?? changed.length, scope.label))} ${renderBar(1)}`,
    );
    printTable(scope, changed);
    console.log(summaryLine('installed', changed, scope.label));
  } catch {}
  return 0;
}

async function runSm(args: string[], spawn: Spawner, scope: AddScope): Promise<number> {
  const before = snapshotSkills(scope.roots, scope.lockPath);
  const entries = entrySignatures(scope.roots);
  const r = await spawn('npx', ['-y', 'skills', 'add', ...args], true);
  if (r.error || r.status !== 0) return reportCapturedFailure(r);
  const changed = changedSince(scope, before);
  if (reportMissing(removeLeftovers(scope, entries, changed, agentRoots(args, scope.roots))))
    return 1;
  console.log(summaryLine('installed', changed, scope.label));
  return 0;
}

export function removedInstallMessage(command: string, args: string[]): string {
  const link = args.find((a) => a === '-ln' || a === '--link');
  return link
    ? `skl ${command} ${link} was removed in 0.4.6, use skl sln`
    : `skl ${command} was removed in 0.4.6, use skl add`;
}

export async function runAdd(argv: string[], deps: AddDeps = {}): Promise<number> {
  if (argv.includes('-h') || argv.includes('--help')) {
    console.log(ADD_HELP);
    return 0;
  }
  const mode = extractMode(argv);
  if (mode.kind === 'error') {
    console.error(`skl add: ${mode.message}`);
    return 1;
  }
  const args = mode.rest;
  if (args.includes('-ln') || args.includes('--link')) {
    console.error('skl add: -ln/--link was removed in 0.4.6, use skl sln');
    return 1;
  }
  if (mode.mode !== 'lg' && !args.includes('-y') && !args.includes('--yes')) {
    console.error(
      `skl add: --mode ${mode.mode} needs -y/--yes (npx skills add asks questions otherwise)`,
    );
    return 1;
  }
  const spawn = deps.spawn ?? defaultSpawn;
  const scope = addScope(args, deps);
  if (mode.mode === 'md') return runMd(args, spawn, scope, deps.online ?? defaultOnline);
  if (mode.mode === 'sm') return runSm(args, spawn, scope);
  return runLg(args, spawn, scope);
}
