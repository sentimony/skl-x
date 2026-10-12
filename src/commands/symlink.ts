import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import { readLock } from '../lock/file';
import { createConfirmer } from '../utils/confirm';
import { extractMode, type OutputMode } from '../utils/mode';
import { renderBar } from '../utils/progress';
import { extractFrontmatter, parseSkillMeta } from '../utils/skill-files';
import { collectRows, renderSkillTable } from '../utils/skill-table';
import { summaryLine } from './add';

export type Agent = 'codex' | 'claude-code';

export const AGENT_DIRS: Record<Agent, string> = {
  codex: '.agents/skills',
  'claude-code': '.claude/skills',
};

const PREFIX = 'skl sln';

export interface SymlinkArgs {
  source: string;
  // null: every skill in the skills folder of <path>
  skills: string[] | null;
  rejects: string[];
  agents: Agent[];
  yes: boolean;
}

export type ParsedSymlinkArgs =
  | { kind: 'error'; message: string }
  | { kind: 'ok'; args: SymlinkArgs };

function isAgent(value: string): value is Agent {
  return value === 'codex' || value === 'claude-code';
}

function fail(message: string): ParsedSymlinkArgs {
  return { kind: 'error', message };
}

export function parseSymlinkArgs(argv: string[]): ParsedSymlinkArgs {
  let source: string | null = null;
  const skills: string[] = [];
  const rejects: string[] = [];
  let skillFlag = false;
  let rejectFlag = false;
  const agents: Agent[] = [];
  let yes = false;
  let i = 0;
  while (i < argv.length) {
    const tok = argv[i] ?? '';
    i++;
    if (tok === '-y' || tok === '--yes') {
      yes = true;
      continue;
    }
    if (tok === '-g' || tok === '--global')
      return fail(`${PREFIX}: -g/--global is not supported yet`);
    if (['-s', '--skill', '-x', '--reject', '-a', '--agent'].includes(tok)) {
      const values: string[] = [];
      // a " name" value (shell "\ name") does not start with "-", so it is collected and skipped later
      while (i < argv.length && !(argv[i] ?? '').startsWith('-')) {
        values.push(argv[i] ?? '');
        i++;
      }
      if (values.length === 0) return fail(`${PREFIX}: ${tok} needs at least one value`);
      if (tok === '-a' || tok === '--agent') {
        for (const value of values) {
          if (!isAgent(value))
            return fail(`Unknown agent: "${value}". Use "codex" or "claude-code".`);
          if (!agents.includes(value)) agents.push(value);
        }
        continue;
      }
      // a name is one path segment: ".." or a slash would escape <path>/skills and the target dirs,
      // and a replace would then rm -rf .agents itself
      const bad = values.find(
        (v) => !v.startsWith(' ') && (v === '' || v === '.' || v === '..' || /[\\/]/.test(v)),
      );
      if (bad !== undefined) return fail(`${PREFIX}: invalid skill name "${bad}"`);
      if (tok === '-s' || tok === '--skill') {
        skillFlag = true;
        skills.push(...values);
      } else {
        rejectFlag = true;
        rejects.push(...values.filter((v) => !v.startsWith(' ')));
      }
      continue;
    }
    if (tok.startsWith('-')) return fail(`Unknown option: ${tok}`);
    if (source !== null) return fail(`${PREFIX} takes one source, got "${source}" and "${tok}"`);
    source = tok;
  }
  if (source === null) return fail(`${PREFIX}: missing <path>`);
  if (skillFlag && rejectFlag)
    return fail(`${PREFIX}: -x/--reject cannot be combined with -s/--skill`);
  return {
    kind: 'ok',
    args: {
      source,
      skills: skillFlag ? skills : null,
      rejects,
      agents: agents.length > 0 ? agents : ['codex', 'claude-code'],
      yes,
    },
  };
}

export type SymlinkAction = 'new' | 'same' | 'replace';
export type Existing = 'none' | 'folder' | 'file' | 'symlink';

export interface SymlinkStep {
  dir: string;
  name: string;
  linkPath: string;
  target: string;
  action: SymlinkAction;
  existing: Existing;
  existingTarget?: string;
}

// Real path of p, resolving the deepest existing ancestor (p itself may not exist yet)
function physicalPath(p: string): string {
  let head = p;
  const rest: string[] = [];
  while (!existsSync(head) && dirname(head) !== head) {
    rest.unshift(basename(head));
    head = dirname(head);
  }
  return join(realpathSync(head), ...rest);
}

export function planSymlinks(opts: {
  cwd: string;
  skillsAbs: string;
  names: string[];
  dirs: string[];
}): SymlinkStep[] {
  const steps: SymlinkStep[] = [];
  const seen = new Set<string>();
  for (const name of opts.names) {
    for (const dir of opts.dirs) {
      const dirAbs = join(opts.cwd, dir);
      // a relative symlink target resolves from the physical parent, so a symlinked
      // .agents/skills needs its real path
      const dirPhys = physicalPath(dirAbs);
      // .claude/skills may be a symlink to .agents/skills: one physical entry, one step
      if (seen.has(join(dirPhys, name))) continue;
      seen.add(join(dirPhys, name));
      const linkPath = join(dirAbs, name);
      const target = relative(dirPhys, join(opts.skillsAbs, name));
      const base = { dir, name, linkPath, target };
      // lstat so a dangling symlink is seen (and replaced) instead of looking absent
      const stat = lstatSync(linkPath, { throwIfNoEntry: false });
      if (!stat) {
        steps.push({ ...base, action: 'new', existing: 'none' });
      } else if (stat.isSymbolicLink()) {
        const existingTarget = readlinkSync(linkPath);
        const action = existingTarget === target ? 'same' : 'replace';
        steps.push({ ...base, action, existing: 'symlink', existingTarget });
      } else {
        steps.push({
          ...base,
          action: 'replace',
          existing: stat.isDirectory() ? 'folder' : 'file',
        });
      }
    }
  }
  return steps;
}

// Collect every directory entry (physical parent + name) that resolving p walks through,
// following symlinks segment by segment, so an entry reached via any alias is seen
function walkEntries(p: string, out: Set<string>, depth = 0): string {
  if (depth > 40) throw new Error(`${PREFIX}: too many levels of symbolic links in ${p}`);
  const root = parse(p).root;
  let cur = root;
  for (const seg of p.slice(root.length).split(sep)) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      cur = dirname(cur);
      continue;
    }
    const entry = join(cur, seg);
    out.add(entry);
    if (lstatSync(entry, { throwIfNoEntry: false })?.isSymbolicLink()) {
      // no join/resolve here: they would fold "link/.." lexically and skip the link's entries
      const target = readlinkSync(entry);
      cur = walkEntries(isAbsolute(target) ? target : cur + sep + target, out, depth + 1);
    } else {
      cur = entry;
    }
  }
  return cur;
}

// A replace deletes the existing entry; refuse when resolving the source of any selected skill
// walks through it: the entry itself (e.g. `skl sln .agents -s tdd` over a symlink, also via an
// alias of .agents, would become a self-link) or a replaced folder that holds the source
export function overlapsSource(
  steps: SymlinkStep[],
  skillsAbs: string,
  names: string[],
): SymlinkStep[] {
  const walked = new Set<string>();
  for (const n of names) walkEntries(join(skillsAbs, n), walked);
  return steps.filter(
    (s) =>
      s.action === 'replace' &&
      walked.has(join(physicalPath(dirname(s.linkPath)), basename(s.linkPath))),
  );
}

export function applySymlinks(steps: SymlinkStep[]): void {
  for (const step of steps) {
    if (step.action === 'same') continue;
    mkdirSync(dirname(step.linkPath), { recursive: true });
    if (step.action === 'replace') rmSync(step.linkPath, { recursive: true, force: true });
    symlinkSync(step.target, step.linkPath, 'dir');
  }
}

// Every <dir>/<name>/SKILL.md, sorted
function skillNames(dir: string): string[] {
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) return [];
  return readdirSync(dir)
    .filter((n) => statSync(join(dir, n, 'SKILL.md'), { throwIfNoEntry: false })?.isFile())
    .sort();
}

// <source>/skills when it holds skills, else <source> itself when it is a skills folder
// (e.g. plugins/<p>/skills); otherwise <source>/skills, so errors name the expected path
export function skillsFolder(sourceAbs: string): string {
  const nested = join(sourceAbs, 'skills');
  if (skillNames(nested).length === 0 && skillNames(sourceAbs).length > 0) return sourceAbs;
  return nested;
}

// Every <skills>/<name>/SKILL.md, sorted, with metadata.internal read from its frontmatter
export function listCandidates(skillsAbs: string): { name: string; internal: boolean }[] {
  return skillNames(skillsAbs).map((name) => {
    const fm = extractFrontmatter(readFileSync(join(skillsAbs, name, 'SKILL.md'), 'utf8'));
    return { name, internal: fm !== undefined && parseSkillMeta(fm).internal };
  });
}

export interface SymlinkDeps {
  cwd?: string;
  confirm?: (question: string) => Promise<boolean>;
  mode?: OutputMode;
}

function describeExisting(step: SymlinkStep): string {
  return step.existing === 'symlink' ? `symlink -> ${step.existingTarget}` : step.existing;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export async function runSymlink(argv: string[], deps: SymlinkDeps = {}): Promise<number> {
  const parsed = parseSymlinkArgs(argv);
  if (parsed.kind === 'error') {
    console.error(parsed.message);
    return 1;
  }
  const { source, skills, rejects, agents, yes } = parsed.args;
  const cwd = deps.cwd ?? process.cwd();
  // createConfirmer, not confirm: on non-TTY stdin it reads to EOF and answers no instead of hanging
  const ask = deps.confirm ?? createConfirmer();
  const mode = deps.mode ?? 'lg';

  const sourceAbs = resolve(cwd, source);
  if (!statSync(sourceAbs, { throwIfNoEntry: false })?.isDirectory()) {
    console.error(`${PREFIX}: ${source} is not a local directory`);
    return 1;
  }
  const skillsAbs = skillsFolder(sourceAbs);
  const skillsShown = skillsAbs === sourceAbs ? source : join(source, 'skills');
  let names: string[];
  if (skills === null) {
    const candidates = listCandidates(skillsAbs);
    const known = new Set(candidates.map((c) => c.name));
    const unknown = rejects.filter((n) => !known.has(n));
    if (unknown.length > 0) {
      for (const n of unknown)
        console.error(`${PREFIX}: --reject: "${n}" is not in ${skillsShown}`);
      return 1;
    }
    const rejected = new Set(rejects);
    names = candidates.filter((c) => !c.internal && !rejected.has(c.name)).map((c) => c.name);
    if (names.length === 0) {
      console.log(`No skills to symlink in ${source}.`);
      return 0;
    }
  } else {
    names = [...new Set(skills.filter((n) => !n.startsWith(' ')))];
    const missing = names.filter((n) => !existsSync(join(skillsAbs, n, 'SKILL.md')));
    if (missing.length > 0) {
      for (const n of missing)
        console.error(`${PREFIX}: ${join(skillsShown, n, 'SKILL.md')} not found`);
      return 1;
    }
  }

  const dirs = agents.map((a) => AGENT_DIRS[a]);
  const steps = planSymlinks({ cwd, skillsAbs, names, dirs });
  const unsafe = overlapsSource(steps, skillsAbs, names);
  if (unsafe.length > 0) {
    for (const s of unsafe)
      console.error(`${PREFIX}: ${s.dir}/${s.name} is the source itself, not replacing it`);
    return 1;
  }
  const replaced = steps.filter((s) => s.action === 'replace');
  if (replaced.length > 0 && !yes) {
    for (const s of replaced) console.log(`${s.dir}/${s.name} - ${describeExisting(s)}`);
    const count = new Set(replaced.map((s) => s.name)).size;
    if (!(await ask(`Replace ${plural(count, 'existing skill')}?`))) return 1;
  }
  if (names.length === 0) {
    console.log(`No skills to symlink in ${source}.`);
    return 0;
  }
  applySymlinks(steps);
  if (mode === 'sm') {
    console.log(summaryLine('Symlinked', names));
    return 0;
  }
  // md and lg look the same: each link as "path -> target" was more noise than detail
  console.log(`Symlinking ${plural(names.length, 'skill')} from ${source} ${renderBar(1)}`);
  const roots = {
    agents: join(cwd, AGENT_DIRS.codex),
    claude: join(cwd, AGENT_DIRS['claude-code']),
  };
  const lockNames = new Set(Object.keys(readLock(join(cwd, 'skills-lock.json')).skills));
  const rows = collectRows(names, roots, lockNames);
  for (const line of renderSkillTable(rows, { lockLabel: 'skills-lock.json', total: false }))
    console.log(line);
  console.log(summaryLine('Symlinked', names));
  return 0;
}

export const SLN_HELP = [
  'Symlink <path>/skills/<name> into .agents/skills and .claude/skills; skills-lock.json is not changed.',
  '<path> may also be the skills folder itself (<path>/<name>/SKILL.md), e.g. plugins/<p>/skills.',
  '',
  'USAGE skl-x sln <path> [-s <SKILL...> | -x <SKILL...>] [-a <AGENT...>] [-y] [-m <MODE>]',
  '',
  'OPTIONS',
  '',
  '  -s, --skill         Skill names (default: every skill except metadata.internal)',
  '  -x, --reject        Every skill except these',
  '  -a, --agent         codex (.agents/skills), claude-code (.claude/skills) (default: both)',
  '  -y, --yes           Replace existing copies without asking',
  '  -m, --mode          md (medium), lg (large, default): a "Symlinking N skills from <path>" line,',
  '                      a table and a "Symlinked N skills · <names>" line',
  '                      sm (small): the "Symlinked N skills · <names>" line only',
  '',
  'EXAMPLES',
  '',
  '  skl sln ../skills -a codex claude-code -y',
  '  skl sln ../skills -x scope-check echarts -y',
  '  skl sln ../skills -s tdd cross-review -a claude-code -m sm',
].join('\n');

export async function runSln(argv: string[], deps: SymlinkDeps = {}): Promise<number> {
  if (argv.includes('-h') || argv.includes('--help')) {
    console.log(SLN_HELP);
    return 0;
  }
  const mode = extractMode(argv);
  if (mode.kind === 'error') {
    console.error(`${PREFIX}: ${mode.message}`);
    return 1;
  }
  return runSymlink(mode.rest, { ...deps, mode: mode.mode });
}
