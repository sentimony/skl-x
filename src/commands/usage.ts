import { join } from 'node:path';
import { defineCommand } from 'citty';
import { type ClaudeMode, readClaudeUsage } from '../readers/claude';
import { type CodexMode, readCodexUsage } from '../readers/codex';
import { bold, cyan, red } from '../utils/ansi';
import { discoverSkills, recordCost } from '../utils/discover-skills';
import { expandHome } from '../utils/expand-home';
import { parsePeriod } from '../utils/period';
import {
  encodeClaudeProjectDir,
  findProjectRoot,
  scopeHeader,
  scopeLockPath,
} from '../utils/scope';
import { formatCost, type SkillCost } from '../utils/skill-files';
import { type Align, alignCells, type Cell, plain } from '../utils/skill-table';

export type Agent = 'claude-code' | 'codex';

export interface UsageArgs {
  agent?: string;
  period: string;
  since?: string;
  mode?: string;
  format: string;
  'scan-all-files': boolean;
}

export interface UsageTableRow {
  name: string;
  counts: Partial<Record<Agent, number>>;
  cost: SkillCost;
}

// codex reads .agents/skills, claude-code reads .claude/skills
const AGENT_COLUMNS: [Agent, string][] = [
  ['codex', '.agents'],
  ['claude-code', '.claude'],
];

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export function renderUsageTable(rows: UsageTableRow[], agents: Agent[]): string[] {
  const cols = AGENT_COLUMNS.filter(([a]) => agents.includes(a));
  const runs = (r: UsageTableRow) => cols.reduce((n, [a]) => n + (r.counts[a] ?? 0), 0);
  const spent = (r: UsageTableRow): SkillCost =>
    typeof r.cost === 'number' ? r.cost * runs(r) : r.cost;
  const sum = (pick: (r: UsageTableRow) => SkillCost) =>
    rows.reduce((n, r) => {
      const v = pick(r);
      return n + (typeof v === 'number' ? v : 0);
    }, 0);
  const sorted = [...rows].sort((a, b) => runs(b) - runs(a) || a.name.localeCompare(b.name));
  const header = ['skill', ...cols.map(([, label]) => label), 'cost', 'total'].map((text) => ({
    text,
    paint: bold,
  }));
  const body = sorted.map((r): Cell[] => [
    { text: r.name, paint: r.cost === 'missing' ? red : cyan },
    ...cols.map(([a]) => plain(String(r.counts[a] ?? 0))),
    plain(formatCost(r.cost)),
    plain(formatCost(spent(r))),
  ]);
  const footer = [
    plain(plural(rows.length, 'skill')),
    ...cols.map(([a]) => plain(String(rows.reduce((n, r) => n + (r.counts[a] ?? 0), 0)))),
    plain(formatCost(sum((r) => r.cost))),
    plain(formatCost(sum(spent))),
  ];
  return alignCells(
    [header, ...body, footer],
    ['left', ...cols.map((): Align => 'right'), 'right', 'right'],
  );
}

function parseAgents(agent: string | undefined): Agent[] {
  if (!agent) return ['claude-code', 'codex'];
  const out = agent
    .split('\x1f')
    .map((a) => a.trim())
    .filter(Boolean)
    .map((a): Agent => {
      if (a === 'codex') return 'codex';
      if (['claude', 'claude-code', 'claudecode'].includes(a)) return 'claude-code';
      throw new Error(
        `Unknown agent: "${a}". Use "claude-code" or "codex" (space-separated for both: -a claude-code codex).`,
      );
    });
  return [...new Set(out)];
}

const MODES = ['merged', 'attributed', 'activations', 'mentions'];
const FORMATS = ['text', 'json'];

function validateChoice(kind: string, value: string | undefined, allowed: string[]): void {
  if (value === undefined || allowed.includes(value)) return;
  const list = allowed.map((v) => `"${v}"`);
  const hint =
    list.length === 2 ? list.join(' or ') : `${list.slice(0, -1).join(', ')} or ${list.at(-1)}`;
  throw new Error(`Unknown ${kind}: "${value}". Use ${hint}.`);
}

export const usageArgs = {
  agent: {
    type: 'string',
    alias: 'a',
    description: 'claude-code, codex (default: both)',
  },
  period: {
    type: 'string',
    alias: 'p',
    default: 'all',
    description: '60s, 30m, 24h, 30d, 2w, 6mo, all',
  },
  since: { type: 'string', description: 'yyyy-mm-dd, overrides --period' },
  mode: {
    type: 'string',
    description: 'merged (default for claude-code) | attributed | activations | mentions',
  },
  format: { type: 'string', default: 'text', description: 'text | json' },
  'scan-all-files': { type: 'boolean', default: false, description: 'Ignore file mtime' },
} as const;

export const REMOVED_FLAGS_ERROR = 'skl usage is project-only: -g and --root were removed in 0.4.5';

// citty silently keeps undeclared flags in args, so removed ones are caught from raw argv.
export function hasRemovedUsageFlag(rawArgs: string[]): boolean {
  return rawArgs.some(
    (a) =>
      a === '-g' ||
      a === '--global' ||
      a.startsWith('--global=') ||
      a === '--root' ||
      a.startsWith('--root='),
  );
}

export async function runUsage(args: UsageArgs): Promise<void> {
  validateChoice('mode', args.mode, MODES);
  validateChoice('format', args.format, FORMATS);
  const agents = parseAgents(args.agent);
  const allTime = !args.since && args.period === 'all';
  const since = args.since
    ? new Date(`${args.since}T00:00:00`)
    : args.period === 'all'
      ? new Date(0)
      : new Date(Date.now() - parsePeriod(args.period));
  const scanAllFiles = allTime || args['scan-all-files'];

  if (Number.isNaN(since.getTime())) {
    console.error(`Invalid --since value: ${args.since}`);
    process.exit(1);
  }

  // Usage is always project-scoped: $HOME is just another project root.
  const projectRoot = findProjectRoot(process.cwd());
  const claudeRoot = join(expandHome('~/.claude/projects'), encodeClaudeProjectDir(projectRoot));

  const lockPath = scopeLockPath(false, process.cwd());
  const skillUniverse = discoverSkills({
    isGlobal: false,
    cwd: process.cwd(),
    lockPath,
  });

  interface AgentResult {
    agent: Agent;
    mode: string;
    rows: Array<{ name: string; count: number; tokens?: number; installed: boolean }>;
    stats: { filesRead: number; linesRead: number };
  }

  const results: AgentResult[] = [];

  for (const agent of agents) {
    let counts: Map<string, number>;
    let stats: { filesRead: number; linesRead: number };
    let mode: string;
    if (agent === 'claude-code') {
      mode = (args.mode ?? 'merged') as ClaudeMode;
      const result = readClaudeUsage({
        since,
        mode: mode as ClaudeMode,
        root: claudeRoot,
        scanAllFiles,
      });
      counts = result.counts;
      stats = { filesRead: result.filesRead, linesRead: result.linesRead };
    } else {
      mode = (args.mode ?? 'activations') as CodexMode;
      const result = readCodexUsage({
        since,
        mode: mode as CodexMode,
        scanAllFiles,
        projectRoot,
      });
      counts = result.counts;
      stats = { filesRead: result.filesRead, linesRead: result.linesRead };
    }

    const universeNames = new Set([...skillUniverse.keys(), ...counts.keys()]);
    const allRows = [...universeNames].map((name) => {
      const rec = skillUniverse.get(name);
      return {
        name,
        count: counts.get(name) ?? 0,
        tokens: rec?.disableModelInvocation ? undefined : rec?.frontmatterTokens,
        installed: rec !== undefined && rec.status !== 'missing',
      };
    });
    const rows = allRows.filter((r) => r.count > 0);

    rows.sort((a, b) => {
      if (a.installed !== b.installed) return a.installed ? -1 : 1;
      if (b.count !== a.count) return b.count - a.count;
      return a.name.localeCompare(b.name);
    });

    results.push({ agent, mode, rows, stats });
  }

  if (args.format === 'json') {
    const output = results.map(({ agent, mode, rows }) => ({
      agent,
      mode,
      since: since.toISOString(),
      skills: rows.map((r) => ({
        skill: r.name,
        count: r.count,
        tokensPerSkill: r.tokens ?? null,
        consumption: (r.tokens ?? 0) * r.count,
        installed: r.installed,
      })),
    }));
    console.log(JSON.stringify(output.length === 1 ? output[0] : output, null, 2));
    return;
  }

  const periodLabel = args.since ? `since ${args.since}` : (args.period ?? 'all');
  const merged = new Map<string, UsageTableRow>();
  for (const { agent, rows } of results)
    for (const r of rows) {
      const row: UsageTableRow = merged.get(r.name) ?? {
        name: r.name,
        counts: {},
        cost: recordCost(skillUniverse.get(r.name)),
      };
      row.counts[agent] = r.count;
      merged.set(r.name, row);
    }
  const times = results.reduce((n, { rows }) => n + rows.reduce((m, r) => m + r.count, 0), 0);
  console.log(`${scopeHeader(false)} · Usage ${plural(times, 'time')} by ${periodLabel}`);
  if (merged.size === 0) {
    console.log(`No skill usage by ${periodLabel}`);
    return;
  }
  for (const line of renderUsageTable([...merged.values()], agents)) console.log(line);
}

export const usageCommand = defineCommand({
  meta: { description: 'Show skill usage x cost (consumption) with missed rows' },
  args: usageArgs,
  async run({ args, rawArgs }) {
    if (hasRemovedUsageFlag(rawArgs)) {
      console.error(REMOVED_FLAGS_ERROR);
      process.exit(1);
    }
    try {
      await runUsage(args as unknown as UsageArgs);
    } catch (e) {
      console.error(e instanceof Error ? e.message : String(e));
      process.exit(1);
    }
  },
});
