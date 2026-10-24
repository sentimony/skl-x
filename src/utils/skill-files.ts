import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

// Calibrated against Claude Code `/skills`: name + description at 3 chars/token
// matches per skill; whole-frontmatter at 4 chars/token matched only in sum.
export const CHARS_PER_TOKEN = 3;

export interface SkillMeta {
  name?: string;
  description?: string;
  disableModelInvocation: boolean;
  // metadata.internal: true hides a skill from `npx skills add` without -s
  internal: boolean;
}

export function getSkillPathCandidates(
  name: string,
  lockPath: string,
  isGlobal: boolean,
): string[] {
  if (isGlobal) {
    return [
      join(homedir(), '.claude', 'skills', name, 'SKILL.md'),
      join(homedir(), '.agents', 'skills', name, 'SKILL.md'),
    ];
  }
  return [join(dirname(resolve(lockPath)), '.claude', 'skills', name, 'SKILL.md')];
}

export function findSkillFile(
  name: string,
  lockPath: string,
  isGlobal: boolean,
): string | undefined {
  for (const p of getSkillPathCandidates(name, lockPath, isGlobal)) {
    if (existsSync(p)) return p;
  }
  return undefined;
}

export function extractFrontmatter(content: string): string | undefined {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return match?.[1];
}

function unquote(value: string): string {
  const m = value.match(/^(["'])([\s\S]*)\1$/);
  return m?.[2] ?? value;
}

// Minimal YAML reader for top-level scalar keys only (zero-dep by design):
// column-0 `key: value`, indented continuation lines, `>`/`|` block indicators.
export function parseSkillMeta(frontmatter: string): SkillMeta {
  const fields = new Map<string, string[]>();
  let current: string[] | undefined;
  for (const line of frontmatter.split(/\r?\n/)) {
    const key = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (key?.[1] !== undefined) {
      current = [];
      fields.set(key[1], current);
      const head = (key[2] ?? '').trim();
      if (head && !/^[>|][+-]?$/.test(head)) current.push(head);
    } else if (current && /^\s/.test(line) && line.trim()) {
      current.push(line.trim());
    } else if (line.trim()) {
      current = undefined;
    }
  }
  const read = (k: string) => {
    const parts = fields.get(k);
    return parts ? unquote(parts.join(' ')) : undefined;
  };
  return {
    name: read('name'),
    description: read('description'),
    disableModelInvocation: read('disable-model-invocation') === 'true',
    // nested metadata lines are kept trimmed as continuation lines of `metadata:`;
    // a YAML comment needs whitespace before `#`
    internal: (fields.get('metadata') ?? []).some((l) =>
      /^internal:\s*(["']?)true\1(?:\s+#.*)?$/.test(l),
    ),
  };
}

export function estimateContextTokens(
  meta: Pick<SkillMeta, 'name' | 'description'>,
  fallbackName: string,
): number {
  const chars = (meta.name ?? fallbackName).length + (meta.description ?? '').length;
  return Math.round(chars / CHARS_PER_TOKEN);
}

export function countFrontmatterTokens(filePath: string): number | undefined {
  const content = readFileSync(filePath, 'utf8');
  const fm = extractFrontmatter(content);
  if (fm === undefined) return undefined;
  return estimateContextTokens(parseSkillMeta(fm), basename(dirname(filePath)));
}

// number - tokens in the always-loaded context; 'hidden' - disable-model-invocation keeps it out
export type SkillCost = number | 'missing' | 'no-frontmatter' | 'hidden';

export function readSkillCost(file: string | undefined, fallbackName: string): SkillCost {
  if (file === undefined || !existsSync(file)) return 'missing';
  const fm = extractFrontmatter(readFileSync(file, 'utf8'));
  if (fm === undefined) return 'no-frontmatter';
  const meta = parseSkillMeta(fm);
  return meta.disableModelInvocation ? 'hidden' : estimateContextTokens(meta, fallbackName);
}

export function formatCost(cost: SkillCost): string {
  if (cost === 'missing') return '~? tok';
  if (cost === 'no-frontmatter') return '(no frontmatter)';
  if (cost === 'hidden') return '-';
  return `~${cost.toLocaleString('en-US')} tok`;
}
