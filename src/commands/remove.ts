import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { defineCommand } from 'citty';
import { countLockLinesToRemove, readLock, removeSkillFromLock } from '../lock/file';
import { gray, green, red, yellow } from '../utils/ansi';
import { createConfirmer } from '../utils/confirm';
import { discoverSkills } from '../utils/discover-skills';
import { countFoldersAndFiles, lstatOrNull, rmSkillDir } from '../utils/fs-rm';
import { extractMode } from '../utils/mode';
import { scopeLockPath } from '../utils/scope';
import { readSkillCost, type SkillCost } from '../utils/skill-files';
import { firstSkillFile, scopeTotalLine } from '../utils/skill-table';

type LocationKind = 'real' | 'symlink' | 'missing';

interface LocationInfo {
  kind: LocationKind;
  subfolders: number;
  files: number;
}

interface SkillTarget {
  name: string;
  agentsDir: string;
  claudeDir: string;
  agents: LocationInfo;
  claude: LocationInfo;
}

type Scope = 'all' | 'lock-only' | 'agents-only' | 'claude-only';

// citty silently ignores unknown flags, which would widen the scope to "all"
const KNOWN_FLAGS = new Set([
  '-g',
  '--global',
  '-y',
  '--yes',
  '--lock-only',
  '--agents-only',
  '--claude-only',
  '-h',
  '--help',
]);

function buildLocation(dir: string): LocationInfo {
  // lstat (not existsSync) so dangling symlinks are still seen and cleaned up
  const stat = lstatOrNull(dir);
  if (!stat) return { kind: 'missing', subfolders: 0, files: 0 };
  if (stat.isSymbolicLink()) return { kind: 'symlink', subfolders: 0, files: 0 };
  const { folders, files } = countFoldersAndFiles(dir);
  return { kind: 'real', subfolders: folders, files };
}

function rootFor(base: '.agents' | '.claude', isGlobal: boolean, lockPath: string): string {
  return isGlobal
    ? join(homedir(), base, 'skills')
    : join(dirname(resolve(lockPath)), base, 'skills');
}

function buildTarget(name: string, isGlobal: boolean, lockPath: string): SkillTarget {
  const agentsDir = join(rootFor('.agents', isGlobal, lockPath), name);
  const claudeDir = join(rootFor('.claude', isGlobal, lockPath), name);
  return {
    name,
    agentsDir,
    claudeDir,
    agents: buildLocation(agentsDir),
    claude: buildLocation(claudeDir),
  };
}

function collectAllTargets(isGlobal: boolean, lockPath: string): SkillTarget[] {
  const map = discoverSkills({ isGlobal, cwd: process.cwd(), lockPath });
  return [...map.keys()].sort().map((name) => buildTarget(name, isGlobal, lockPath));
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function header(targets: SkillTarget[], verb: string): string {
  const names = targets.map((t) => red(t.name)).join(' ');
  return `${plural(targets.length, 'skill')} ${names} ${verb}`;
}

function aggregateLocations(infos: LocationInfo[]): {
  folders: number;
  subfolders: number;
  files: number;
  symlinks: number;
  found: boolean;
} {
  let folders = 0;
  let subfolders = 0;
  let files = 0;
  let symlinks = 0;
  for (const info of infos) {
    if (info.kind === 'real') {
      folders += 1;
      subfolders += info.subfolders;
      files += info.files;
    } else if (info.kind === 'symlink') {
      symlinks += 1;
    }
  }
  return { folders, subfolders, files, symlinks, found: infos.some((i) => i.kind !== 'missing') };
}

function diskCell(infos: LocationInfo[], variant: 'plan' | 'summary'): string {
  const agg = aggregateLocations(infos);
  if (!agg.found) return 'not found';
  const parts: string[] = [];
  if (agg.folders > 0 || agg.files > 0) {
    const text = `${plural(agg.folders, 'folder')}, ${plural(agg.subfolders, 'subfolder')}, ${plural(agg.files, 'file')}`;
    parts.push(variant === 'summary' ? red(text) : green(text));
  }
  if (agg.symlinks > 0) {
    const text = plural(agg.symlinks, 'symlink');
    parts.push(variant === 'summary' ? red(text) : yellow(text));
  }
  return parts.join(', ');
}

function lockCell(skills: number, lines: number, variant: 'removed' | 'kept'): string {
  if (lines === 0) return 'not in lock';
  const text = `${plural(skills, 'skill')} (${plural(lines, 'line')})`;
  if (variant === 'kept') return green(`${text} kept`);
  return red(text);
}

function printBlock(
  targets: SkillTarget[],
  scope: Scope,
  verb: string,
  lockSkillsToRemove: number,
  lockLinesToRemove: number,
  diskVariant: 'plan' | 'summary',
  lockVariant: 'removed' | 'kept',
): void {
  console.log(header(targets, verb));
  const rows: Array<[label: string, cell: string]> = [];
  if (scope === 'all' || scope === 'agents-only') {
    rows.push([
      '.agents/skills/',
      diskCell(
        targets.map((t) => t.agents),
        diskVariant,
      ),
    ]);
  }
  if (scope === 'all' || scope === 'claude-only') {
    rows.push([
      '.claude/skills/',
      diskCell(
        targets.map((t) => t.claude),
        diskVariant,
      ),
    ]);
  }
  if (scope === 'all' || scope === 'lock-only') {
    rows.push(['skills-lock.json', lockCell(lockSkillsToRemove, lockLinesToRemove, lockVariant)]);
  }
  const labelWidth = Math.max(...rows.map(([label]) => label.length));
  for (const [label, cell] of rows) {
    console.log(`${label.padEnd(labelWidth)}  ${cell}`);
  }
}

export const removeCommand = defineCommand({
  meta: {
    description: 'Remove one or more skills from on-disk dirs and/or skills-lock.json',
  },
  args: {
    global: { type: 'boolean', alias: 'g', default: false, description: 'Use global scope' },
    yes: { type: 'boolean', alias: 'y', default: false, description: 'Skip confirmation prompts' },
    'lock-only': {
      type: 'boolean',
      default: false,
      description: 'Only remove the skills-lock.json entry; keep on-disk directories',
    },
    'agents-only': {
      type: 'boolean',
      default: false,
      description: 'Only remove from .agents/skills; keep .claude/skills and the lock entry',
    },
    'claude-only': {
      type: 'boolean',
      default: false,
      description: 'Only remove from .claude/skills; keep .agents/skills and the lock entry',
    },
    reject: {
      type: 'string',
      alias: 'x',
      description: 'With ".": skill names to keep (space-separated)',
    },
  },
  async run({ args }) {
    const {
      global: isGlobal,
      yes,
      'lock-only': lockOnly,
      'agents-only': agentsOnly,
      'claude-only': claudeOnly,
    } = args;

    const onlyFlagCount = [lockOnly, agentsOnly, claudeOnly].filter(Boolean).length;
    if (onlyFlagCount > 1) {
      console.error('--lock-only, --agents-only, and --claude-only are mutually exclusive');
      process.exit(1);
    }
    const scope: Scope = lockOnly
      ? 'lock-only'
      : agentsOnly
        ? 'agents-only'
        : claudeOnly
          ? 'claude-only'
          : 'all';

    // Manual argv parse: citty can't collect multiple space-separated values
    // for positionals or for -x/--reject
    const subcmdIdx = process.argv.findIndex((a) => a === 'remove' || a === 'rm');
    const mode = extractMode(process.argv.slice(subcmdIdx + 1));
    if (mode.kind === 'error') {
      console.error(`skl rm: ${mode.message}`);
      process.exit(1);
    }
    const stealth = mode.mode !== 'lg';
    const tokens = mode.rest;
    const rawNames: string[] = [];
    const rejects: string[] = [];
    let rejectFlagSeen = false;
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      if (tok === undefined) continue;
      if (tok === '-x' || tok === '--reject') {
        rejectFlagSeen = true;
        let next = tokens[i + 1];
        while (next !== undefined && !next.startsWith('-') && next !== '.') {
          rejects.push(next);
          i++;
          next = tokens[i + 1];
        }
        continue;
      }
      if (tok.startsWith('--reject=')) {
        rejectFlagSeen = true;
        rejects.push(tok.slice('--reject='.length));
        continue;
      }
      if (!tok.startsWith('-')) {
        rawNames.push(tok);
      } else if (!KNOWN_FLAGS.has(tok.split('=')[0] ?? tok)) {
        console.error(`Unknown option: ${tok}`);
        process.exit(1);
      }
    }
    const all = rawNames.includes('.');
    const names = rawNames.filter((n) => n !== '.');

    if (all && names.length > 0) {
      console.error('"." (all skills) is mutually exclusive with positional skill names');
      process.exit(1);
    }

    if (!all && names.length === 0) {
      console.error('No skill names provided');
      process.exit(1);
    }

    if (rejectFlagSeen && !all) {
      console.error('-x/--reject is only valid with "." (all skills)');
      process.exit(1);
    }
    if (rejectFlagSeen && rejects.length === 0) {
      console.error('-x/--reject requires at least one skill name');
      process.exit(1);
    }

    const lockPath = scopeLockPath(isGlobal, process.cwd());

    let targets: SkillTarget[] = all
      ? collectAllTargets(isGlobal, lockPath)
      : names.map((n) => buildTarget(n, isGlobal, lockPath));

    if (rejects.length > 0) {
      const inScope = new Set(targets.map((t) => t.name));
      const unknown = rejects.filter((n) => !inScope.has(n));
      if (unknown.length > 0) {
        for (const n of unknown) console.error(`--reject: "${n}" is not in scope`);
        process.exit(1);
      }
      const rejectSet = new Set(rejects);
      targets = targets.filter((t) => !rejectSet.has(t.name));
    }

    if (all && targets.length === 0) {
      console.log(stealth ? gray(scopeTotalLine(isGlobal, 0, 0)) : 'No skills to remove in scope.');
      return;
    }

    const lockNames = new Set(Object.keys(readLock(lockPath).skills));
    const orphan = targets.filter(
      (t) => t.agents.kind === 'missing' && t.claude.kind === 'missing' && !lockNames.has(t.name),
    );
    if (orphan.length) {
      for (const o of orphan) console.log(`"${o.name}" is not in lock or on disk`);
      process.exit(1);
    }

    const lockLinesToRemove = countLockLinesToRemove(
      lockPath,
      targets.map((t) => t.name),
    );
    const lockSkillsToRemove = targets.filter((t) => lockNames.has(t.name)).length;
    // read before anything is removed: SKILL.md is gone afterwards. Only the sm/md line needs
    // it, and an unreadable SKILL.md must not block the removal
    const roots = {
      agents: rootFor('.agents', isGlobal, lockPath),
      claude: rootFor('.claude', isGlobal, lockPath),
    };
    const costs = new Map<string, SkillCost>();
    if (stealth) {
      for (const t of targets) {
        try {
          costs.set(t.name, readSkillCost(firstSkillFile(roots, t.name), t.name));
        } catch {
          costs.set(t.name, 'missing');
        }
      }
    }

    const ask = createConfirmer();

    if (!yes) {
      printBlock(
        targets,
        scope,
        'will be removed from:',
        lockSkillsToRemove,
        lockLinesToRemove,
        'plan',
        'removed',
      );
      console.log('');
      const ok = await ask('Proceed?');
      if (!ok) {
        console.log('Aborted');
        process.exit(1);
      }
    }

    const allowedRoots = [isGlobal ? homedir() : dirname(resolve(lockPath)), homedir()];

    if (scope === 'all' || scope === 'agents-only') {
      for (const t of targets) rmSkillDir(t.agentsDir, { allowedRoots });
    }
    if (scope === 'all' || scope === 'claude-only') {
      for (const t of targets) rmSkillDir(t.claudeDir, { allowedRoots });
    }

    let lockCleaned = false;
    if (scope === 'lock-only') {
      for (const t of targets) removeSkillFromLock(lockPath, t.name);
      lockCleaned = true;
    } else if (scope === 'all' && lockLinesToRemove > 0) {
      let cleanLock = yes;
      if (!yes) {
        console.log('');
        cleanLock = await ask(`Clean skills-lock.json (${plural(lockLinesToRemove, 'line')})?`);
      }
      if (cleanLock) {
        for (const t of targets) removeSkillFromLock(lockPath, t.name);
        lockCleaned = true;
      }
    }

    if (!yes) console.log('');
    if (stealth) {
      const agentsInScope = scope === 'all' || scope === 'agents-only';
      const claudeInScope = scope === 'all' || scope === 'claude-only';
      // a set: `skl rm foo foo` builds two targets of one skill
      const removed = new Set(
        targets
          .filter(
            (t) =>
              (agentsInScope && t.agents.kind !== 'missing') ||
              (claudeInScope && t.claude.kind !== 'missing') ||
              (lockCleaned && lockNames.has(t.name)),
          )
          .map((t) => t.name),
      );
      const cost = [...removed].reduce((n, name) => {
        const c = costs.get(name);
        return n + (typeof c === 'number' ? c : 0);
      }, 0);
      console.log(gray(scopeTotalLine(isGlobal, removed.size, cost, '-')));
      return;
    }
    printBlock(
      targets,
      scope,
      'removed from:',
      lockSkillsToRemove,
      lockLinesToRemove,
      'summary',
      lockCleaned ? 'removed' : 'kept',
    );
  },
});
