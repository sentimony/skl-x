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
import { readLock, removeSkillFromLock } from '../lock/file';
import { createConfirmer } from '../utils/confirm';
import { rmSkillDir } from '../utils/fs-rm';
import { extractMode, type OutputMode } from '../utils/mode';
import { createProgress } from '../utils/progress';
import { scopeLabel } from '../utils/scope';
import { extractFrontmatter, parseSkillMeta } from '../utils/skill-files';
import { collectRows, renderSkillTable } from '../utils/skill-table';
import { summaryLine } from './add';

export type Agent = 'codex' | 'claude-code';

export const AGENT_DIRS: Record<Agent, string> = {
  codex: '.agents/skills',
  'claude-code': '.claude/skills',
};

const PREFIX = 'skl sln';
// sln has no -g yet, so it always links into the project
const SCOPE = scopeLabel(false);

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

export interface StaleEntry {
  dir: string;
  name: string;
  linkPath: string;
  existing: Existing;
  existingTarget?: string;
}

// Entries of the selected skills in agent dirs outside -a, which skl rm would remove too:
// a copy left there shadows the link for that agent. An entry that is physically one of the
// planned links (.claude/skills -> .agents/skills) is not stale
export function planRemovals(opts: {
  cwd: string;
  names: string[];
  dirs: string[];
  steps: SymlinkStep[];
}): StaleEntry[] {
  const linked = new Set(
    opts.steps.map((s) => join(physicalPath(dirname(s.linkPath)), basename(s.linkPath))),
  );
  const out: StaleEntry[] = [];
  for (const name of opts.names) {
    for (const dir of Object.values(AGENT_DIRS)) {
      if (opts.dirs.includes(dir)) continue;
      const dirAbs = join(opts.cwd, dir);
      if (linked.has(join(physicalPath(dirAbs), name))) continue;
      const linkPath = join(dirAbs, name);
      // lstat: a dangling symlink is stale too
      const stat = lstatSync(linkPath, { throwIfNoEntry: false });
      if (!stat) continue;
      if (stat.isSymbolicLink())
        out.push({
          dir,
          name,
          linkPath,
          existing: 'symlink',
          existingTarget: readlinkSync(linkPath),
        });
      else out.push({ dir, name, linkPath, existing: stat.isDirectory() ? 'folder' : 'file' });
    }
  }
  return out;
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

// A replace or a removal deletes the existing entry; refuse when resolving the source of any
// selected skill walks through it: the entry itself (e.g. `skl sln .agents -s tdd` over a symlink,
// also via an alias of .agents, would become a self-link) or a deleted folder that holds the source
export function overlapsSource<T extends { linkPath: string }>(
  deleted: T[],
  skillsAbs: string,
  names: string[],
): T[] {
  const walked = new Set<string>();
  for (const n of names) walkEntries(join(skillsAbs, n), walked);
  return deleted.filter((s) =>
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

// folders the recursive search never enters, besides hidden ones (installed copies in .agents, .claude)
const SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage']);
// a plugin skill sits at plugins/<p>/skills/<name>, four levels below the repo
const MAX_DEPTH = 5;

export interface FoundSkill {
  name: string;
  // the folder that holds <name>/SKILL.md
  folder: string;
}

export interface SourceSkills {
  skills: FoundSkill[];
  // folder name -> its SKILL.md, for a SKILL.md whose frontmatter names another skill
  mismatched: Map<string, string>;
  // the skills folder, or null when the skills were found by the recursive search
  folder: string | null;
}

// the file's text, or undefined when it is missing or a folder
function readIfFile(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
}

// <dir>/SKILL.md below dir whose frontmatter name is <dir>; no symlinks, nothing inside a skill
function walkSkills(dir: string, depth: number, out: SourceSkills): void {
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  for (const entry of entries) {
    // a Dirent of a symlink is not a directory, so links (and their cycles) are skipped
    if (!entry.isDirectory() || entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
    const child = join(dir, entry.name);
    const md = join(child, 'SKILL.md');
    // read without a stat first: a check before the read is a race (CodeQL js/file-system-race)
    const text = readIfFile(md);
    if (text !== undefined) {
      const fm = extractFrontmatter(text);
      if (fm !== undefined && parseSkillMeta(fm).name === entry.name)
        out.skills.push({ name: entry.name, folder: dir });
      else out.mismatched.set(entry.name, md);
      continue;
    }
    if (depth < MAX_DEPTH) walkSkills(child, depth + 1, out);
  }
}

// The skills of <source>: <source>/skills when it holds skills, else <source> itself when it is a
// skills folder (e.g. plugins/<p>/skills), else the recursive search (a plugin repo such as
// sentimony/skills); with nothing found, <source>/skills, so errors name the expected path
export function findSkills(sourceAbs: string): SourceSkills {
  const nested = join(sourceAbs, 'skills');
  const direct = [nested, sourceAbs].find((f) => skillNames(f).length > 0);
  if (direct === undefined) {
    const found: SourceSkills = { skills: [], mismatched: new Map(), folder: null };
    walkSkills(sourceAbs, 1, found);
    if (found.skills.length > 0) return found;
  }
  const folder = direct ?? nested;
  return {
    skills: skillNames(folder).map((name) => ({ name, folder })),
    mismatched: new Map(),
    folder,
  };
}

function isInternal(skillDir: string): boolean {
  const fm = extractFrontmatter(readFileSync(join(skillDir, 'SKILL.md'), 'utf8'));
  return fm !== undefined && parseSkillMeta(fm).internal;
}

export interface SymlinkDeps {
  cwd?: string;
  confirm?: (question: string) => Promise<boolean>;
  mode?: OutputMode;
}

function describeExisting(step: { existing: Existing; existingTarget?: string }): string {
  return step.existing === 'symlink' ? `symlink -> ${step.existingTarget}` : step.existing;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export const SLN_FRAME_MS = 50;

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
  const found = findSkills(sourceAbs);
  const skillsShown =
    found.folder === null || found.folder === sourceAbs ? source : join(source, 'skills');
  // the folder each skill name is linked from; a name found in two folders is ambiguous
  const folderOf = new Map<string, string>();
  const ambiguous = new Map<string, string[]>();
  for (const { name, folder } of found.skills) {
    const prev = folderOf.get(name);
    if (prev !== undefined) ambiguous.set(name, [...(ambiguous.get(name) ?? [prev]), folder]);
    else folderOf.set(name, folder);
  }
  let names: string[];
  if (skills === null) {
    const candidates = found.skills
      .map(({ name, folder }) => ({ name, internal: isInternal(join(folder, name)) }))
      .sort((a, b) => a.name.localeCompare(b.name));
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
    const missing = names.filter((n) => !folderOf.has(n));
    if (missing.length > 0) {
      for (const n of missing) {
        const md = found.mismatched.get(n);
        if (md !== undefined)
          console.error(`${PREFIX}: ${relative(cwd, md)} is not named ${n} in its frontmatter`);
        else if (found.folder === null)
          console.error(`${PREFIX}: no ${n}/SKILL.md in ${skillsShown}`);
        else console.error(`${PREFIX}: ${join(skillsShown, n, 'SKILL.md')} not found`);
      }
      return 1;
    }
  }

  const clashes = names.filter((n) => ambiguous.has(n));
  if (clashes.length > 0) {
    for (const n of clashes) {
      const where = (ambiguous.get(n) ?? []).map((f) => relative(cwd, f)).join(', ');
      console.error(`${PREFIX}: ${n} is in more than one folder: ${where}`);
    }
    return 1;
  }
  const dirs = agents.map((a) => AGENT_DIRS[a]);
  // one group per skills folder: in a plugin repo each plugin has its own
  const groups = [...new Set(folderOf.values())]
    .map((f) => ({ skillsAbs: f, names: names.filter((n) => folderOf.get(n) === f) }))
    .filter((g) => g.names.length > 0);
  const steps = groups.flatMap((g) => planSymlinks({ cwd, ...g, dirs }));
  const removals = planRemovals({ cwd, names, dirs, steps });
  const replaced = steps.filter((s) => s.action === 'replace');
  const deleted = [...replaced, ...removals];
  const unsafe = [...new Set(groups.flatMap((g) => overlapsSource(deleted, g.skillsAbs, g.names)))];
  if (unsafe.length > 0) {
    for (const s of unsafe)
      console.error(`${PREFIX}: ${s.dir}/${s.name} is the source itself, not replacing it`);
    return 1;
  }
  // a lock entry would bring a copy back over the link on the next add or update
  const lockPath = join(cwd, 'skills-lock.json');
  const inLock = Object.keys(readLock(lockPath).skills);
  const lockHits = names.filter((n) => inLock.includes(n));
  if ((deleted.length > 0 || lockHits.length > 0) && !yes) {
    for (const s of deleted) console.log(`${s.dir}/${s.name} - ${describeExisting(s)}`);
    for (const n of lockHits) console.log(`skills-lock.json - ${n}`);
    const count = new Set([...deleted.map((s) => s.name), ...lockHits]).size;
    if (!(await ask(`Replace ${plural(count, 'existing skill')}?`))) return 1;
  }
  const apply = () => {
    for (const r of removals) rmSkillDir(r.linkPath, { allowedRoots: [cwd] });
    for (const n of lockHits) removeSkillFromLock(lockPath, n);
    applySymlinks(steps);
  };
  if (names.length === 0) {
    console.log(`No skills to symlink in ${source}.`);
    return 0;
  }
  if (mode === 'sm') {
    apply();
    console.log(summaryLine('symlinked', names, SCOPE));
    return 0;
  }
  // md and lg look the same: each link as "path -> target" was more noise than detail.
  // Linking takes milliseconds, so the bar just runs through its nine cells, SLN_FRAME_MS each
  const progress = createProgress(
    `Symlinking ${plural(names.length, 'skill')} from ${source} to ${SCOPE}`,
    undefined,
    { introCells: 9, frameMs: SLN_FRAME_MS },
  );
  progress.start();
  try {
    apply();
  } catch (e) {
    progress.fail();
    throw e;
  }
  await progress.filled();
  await progress.done();
  const roots = {
    agents: join(cwd, AGENT_DIRS.codex),
    claude: join(cwd, AGENT_DIRS['claude-code']),
  };
  const lockNames = new Set(Object.keys(readLock(lockPath).skills));
  const rows = collectRows(names, roots, lockNames);
  for (const line of renderSkillTable(rows, { lockLabel: 'skills-lock.json', total: false }))
    console.log(line);
  console.log(summaryLine('symlinked', names, SCOPE));
  return 0;
}

export const SLN_HELP = [
  'Symlink <path>/skills/<name> into .agents/skills and .claude/skills. Like skl rm, it first',
  'removes the skill from the other agent dir and from skills-lock.json.',
  '<path> may also be the skills folder itself (<path>/<name>/SKILL.md), e.g. plugins/<p>/skills.',
  'Otherwise every <name>/SKILL.md below <path> named <name> in its frontmatter is a skill,',
  'e.g. plugins/<p>/skills/<name> in a plugin repo (hidden folders and node_modules are skipped).',
  '',
  'USAGE skl-x sln <path> [-s <SKILL...> | -x <SKILL...>] [-a <AGENT...>] [-y] [-m <MODE>]',
  '',
  'OPTIONS',
  '',
  '  -s, --skill         Skill names (default: every skill except metadata.internal)',
  '  -x, --reject        Every skill except these',
  '  -a, --agent         codex (.agents/skills), claude-code (.claude/skills) (default: both)',
  '  -y, --yes           Replace and remove existing copies without asking',
  '  -m, --mode          md (medium), lg (large, default): a "Symlinking N skills from <path>" line,',
  '                      a table and a "<scope> · +N skills symlinked · <names>" line',
  '                      sm (small): the "<scope> · +N skills symlinked · <names>" line only',
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
