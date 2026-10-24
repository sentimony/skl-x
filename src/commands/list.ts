import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { defineCommand } from 'citty';
import { gray } from '../utils/ansi';
import { discoverSkills } from '../utils/discover-skills';
import { extractMode } from '../utils/mode';
import { scopeHeader, scopeLockPath } from '../utils/scope';
import { collectRows, renderSkillTable, scopeTotalLine } from '../utils/skill-table';

function rootFor(isGlobal: boolean, lockPath: string, kind: '.claude' | '.agents'): string {
  if (isGlobal) return join(homedir(), kind, 'skills');
  return join(dirname(resolve(lockPath)), kind, 'skills');
}

export const listCommand = defineCommand({
  meta: { description: 'List skills as a table: .agents, .claude and lock per skill' },
  args: {
    global: { type: 'boolean', alias: 'g', default: false, description: 'Use global scope' },
    names: {
      type: 'boolean',
      default: false,
      description: 'Print one skill name per line (no header, no colors) - for completion scripts',
    },
    mode: {
      type: 'string',
      alias: 'm',
      description:
        'sm (small): one "<scope> · N skills · ~X tok" line; md, lg (default): the table',
    },
  },
  run({ args }) {
    // citty only documents -m; extractMode gives the same errors as rm, add and sln
    const subcmdIdx = process.argv.findIndex((a) => a === 'list' || a === 'ls');
    const mode = extractMode(process.argv.slice(subcmdIdx + 1));
    if (mode.kind === 'error') {
      console.error(`skl ls: ${mode.message}`);
      process.exit(1);
    }
    const lockPath = scopeLockPath(args.global, process.cwd());
    const records = [
      ...discoverSkills({ isGlobal: args.global, cwd: process.cwd(), lockPath }).values(),
    ];

    if (args.names) {
      for (const name of records.map((r) => r.name).sort()) console.log(name);
      return;
    }

    if (mode.mode === 'sm' && records.length === 0) {
      console.log(gray(scopeTotalLine(args.global, 0, 0)));
      return;
    }
    if (mode.mode !== 'sm') console.log(scopeHeader(args.global));
    if (records.length === 0) {
      console.log('No skills in scope.');
      return;
    }
    const roots = {
      agents: rootFor(args.global, lockPath, '.agents'),
      claude: rootFor(args.global, lockPath, '.claude'),
    };
    const lockNames = new Set(records.filter((r) => r.sources.includes('lock')).map((r) => r.name));
    const rows = collectRows(
      records.map((r) => r.name),
      roots,
      lockNames,
    );
    if (mode.mode === 'sm') {
      const cost = rows.reduce((n, r) => n + (typeof r.cost === 'number' ? r.cost : 0), 0);
      console.log(gray(scopeTotalLine(args.global, rows.length, cost)));
      return;
    }
    const lockLabel = args.global ? '.agents/.skill-lock.json' : 'skills-lock.json';
    for (const line of renderSkillTable(rows, { lockLabel, total: true })) console.log(line);
  },
});
