// src/utils/skill-table.ts
import { existsSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { bold, cyan, green, red, yellow } from './ansi';
import { scopeLabel } from './scope';
import { formatCost, readSkillCost, type SkillCost } from './skill-files';

export type Install = 'real' | 'symlink' | 'broken';

export interface SkillRoots {
  agents: string;
  claude: string;
}

export interface SkillRow {
  name: string;
  agents?: Install;
  claude?: Install;
  inLock: boolean;
  cost: SkillCost;
}

export function getInstall(root: string, name: string): Install | undefined {
  const dir = join(root, name);
  // lstat (not existsSync) so a dangling symlink is classified as 'broken', not absent
  const stat = lstatSync(dir, { throwIfNoEntry: false });
  if (!stat) return undefined;
  if (stat.isSymbolicLink()) return existsSync(dir) ? 'symlink' : 'broken';
  return 'real';
}

// .claude first, as discoverSkills does; existsSync follows a symlinked skill dir
export function firstSkillFile(roots: SkillRoots, name: string): string | undefined {
  return [roots.claude, roots.agents]
    .map((root) => join(root, name, 'SKILL.md'))
    .find((p) => existsSync(p));
}

export function collectRows(
  names: Iterable<string>,
  roots: SkillRoots,
  lockNames: Set<string>,
): SkillRow[] {
  return [...new Set(names)]
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({
      name,
      agents: getInstall(roots.agents, name),
      claude: getInstall(roots.claude, name),
      inLock: lockNames.has(name),
      cost: readSkillCost(firstSkillFile(roots, name), name),
    }));
}

export interface Cell {
  text: string;
  paint: (s: string) => string;
}

export const plain = (text: string): Cell => ({ text, paint: (s) => s });

export type Align = 'left' | 'right' | 'center';

function pad(text: string, width: number, align: Align): [string, string] {
  const d = width - text.length;
  if (align === 'right') return [' '.repeat(d), ''];
  if (align === 'center') return [' '.repeat(Math.floor(d / 2)), ' '.repeat(d - Math.floor(d / 2))];
  return ['', ' '.repeat(d)];
}

// pad by the uncolored text so ANSI codes do not break the alignment; a column without align is left
export function alignCells(lines: Cell[][], align: Align[] = []): string[] {
  const cols = Math.max(...lines.map((l) => l.length));
  const widths = Array.from({ length: cols }, (_, i) =>
    Math.max(...lines.map((l) => l[i]?.text.length ?? 0)),
  );
  return lines.map((cells) =>
    cells
      .map((c, i) => {
        const [left, right] = pad(c.text, widths[i] ?? 0, align[i] ?? 'left');
        return left + c.paint(c.text) + right;
      })
      .join('  ')
      .trimEnd(),
  );
}

// a real folder in .agents/skills is the canonical copy of `npx skills`; in .claude/skills it is a copy
function installCell(install: Install | undefined, realLabel: string): Cell {
  if (install === 'real') return { text: realLabel, paint: green };
  if (install === 'symlink') return { text: 'symlinked', paint: yellow };
  if (install === 'broken') return { text: 'broken', paint: red };
  return plain('-');
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

// "Project scope · -30 skills removed · ~3,333 tok"; the sm line of skl rm (sign '-') and skl ls
export function scopeTotalLine(
  isGlobal: boolean,
  skills: number,
  cost: number,
  sign: '' | '-' = '',
): string {
  const scope = scopeLabel(isGlobal);
  if (skills === 0) return `${scope} · No skills`;
  const removed = sign === '-' ? ' removed' : '';
  return `${scope} · ${sign}${plural(skills, 'skill')}${removed} · ${formatCost(cost)}`;
}

export function renderSkillTable(
  rows: SkillRow[],
  opts: { lockLabel: string; total: boolean },
): string[] {
  const header = ['skill', '.agents', '.claude', opts.lockLabel, 'cost'].map((text) => ({
    text,
    paint: bold,
  }));
  const body = rows.map((r) => {
    const orphan = r.inLock && !r.agents && !r.claude;
    const lock: Cell = r.inLock
      ? { text: '+', paint: orphan ? red : green }
      : { text: '-', paint: yellow };
    return [
      { text: r.name, paint: cyan },
      installCell(r.agents, 'universal'),
      installCell(r.claude, 'copied'),
      lock,
      plain(formatCost(r.cost)),
    ];
  });
  const lines: Cell[][] = [header, ...body];
  if (opts.total) {
    const count = (has: (r: SkillRow) => boolean) => plain(String(rows.filter(has).length));
    lines.push([
      plain(plural(rows.length, 'skill')),
      count((r) => r.agents !== undefined),
      count((r) => r.claude !== undefined),
      count((r) => r.inLock),
      plain(formatCost(rows.reduce((n, r) => n + (typeof r.cost === 'number' ? r.cost : 0), 0))),
    ]);
  }
  return alignCells(lines, ['left', 'right', 'right', 'center', 'right']);
}
