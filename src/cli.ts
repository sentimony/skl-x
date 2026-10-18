#!/usr/bin/env node
import { createRequire } from 'node:module';
import { defineCommand, runMain } from 'citty';
import { removedInstallMessage, runAdd } from './commands/add';
import { completionCommand } from './commands/completion';
import { costCommand } from './commands/cost';
import { listCommand } from './commands/list';
import { removeCommand } from './commands/remove';
import { runSln } from './commands/symlink';
import { runUpdate } from './commands/update';
import { usageCommand } from './commands/usage';
import { detectColorSupport, setColorEnabled } from './utils/ansi';
import { maybePrintUpdateNotice } from './utils/update-check';

const { version } = createRequire(import.meta.url)('../package.json') as { version: string };

function mergeAgentArgs(argv: string[]): string[] {
  const out: string[] = [];
  const values: string[] = [];
  let slotIdx = -1;
  let i = 0;
  while (i < argv.length) {
    const tok = argv[i];
    if (tok === undefined) {
      i++;
      continue;
    }
    if (tok === '-a' || tok === '--agent') {
      if (slotIdx === -1) slotIdx = out.length;
      let j = i + 1;
      while (j < argv.length) {
        const next = argv[j];
        if (next === undefined || next.startsWith('-')) break;
        values.push(next);
        j++;
      }
      i = j;
      continue;
    }
    out.push(tok);
    i++;
  }
  if (values.length > 0 && slotIdx !== -1) out.splice(slotIdx, 0, '--agent', values.join('\x1f'));
  return out;
}

const SUBCOMMAND_NAMES = new Set([
  'list',
  'ls',
  'remove',
  'rm',
  'cost',
  'cst',
  'usage',
  'usg',
  'completion',
]);

function reorderRootFlagsToSubcommand(argv: string[]): string[] {
  const tail = argv.slice(2);
  const subIdx = tail.findIndex((t) => !!t && SUBCOMMAND_NAMES.has(t));
  if (subIdx <= 0) return argv;
  const before = tail.slice(0, subIdx);
  const sub = tail[subIdx];
  const after = tail.slice(subIdx + 1);
  if (!sub) return argv;
  return [argv[0] ?? '', argv[1] ?? '', sub, ...before, ...after];
}

// add and sln take raw argv: mergeAgentArgs would join -a values with \x1f and citty
// cannot hold several -s values. Only -g/--global may precede them, so an option value
// such as `--since add` never turns into a command; these names stay out of SUBCOMMAND_NAMES
// for the same reason. install and i are here only to point at add and sln. update and up
// skip the update notice, so they are raw too.
const RAW_COMMANDS = new Set(['add', 'sln', 'install', 'i', 'update', 'up']);

function detectRawCommand(argv: string[]): { command: string; args: string[] } | null {
  const tail = argv.slice(2);
  const idx = tail.findIndex((t) => t !== '-g' && t !== '--global');
  const command = idx === -1 ? undefined : tail[idx];
  if (command === undefined || !RAW_COMMANDS.has(command)) return null;
  // leading -g/--global go first, as reorderRootFlagsToSubcommand does for other commands
  return { command, args: [...tail.slice(0, idx), ...tail.slice(idx + 1)] };
}

const raw = detectRawCommand(process.argv);
if (!raw) process.argv = reorderRootFlagsToSubcommand(mergeAgentArgs(process.argv));

function printRootHelp(): void {
  const lines = [
    `Audit and manage AI agent skills (skl-x v${version})`,
    '',
    'USAGE skl-x [OPTIONS] [COMMAND]',
    '',
    'OPTIONS',
    '',
    '  -h, --help       Show this help and exit',
    '  -v, --version    Show version and exit',
    '  -g, --global     Use global scope (default: false)',
    '  -p, --period     Period for `usage`: 60s, 30m, 24h, 30d, 2w, 6mo, all (default: all)',
    '  -a, --agent      Agent for `usage`: claude-code, codex (default: both)',
    '',
    'COMMANDS',
    '',
    '  list, ls         List skills as a table: .agents, .claude and lock per skill',
    '  remove, rm       Delete on-disk skill dirs and/or skills-lock.json (interactive)',
    '  cost, cst        Show ambient context cost (per-skill name + description tokens) sorted desc',
    '  usage, usg       Show skill usage × cost (consumption) with missed rows',
    '  add              Install skills via `npx skills add`',
    '  sln              Symlink skills from a local clone into .agents/skills and .claude/skills',
    '  update, up       Install the latest skl-x globally (npm i -g)',
    '  completion       Print shell completion script (bash, zsh, fish)',
  ];
  console.log(lines.join('\n'));
}

function isRootHelp(argv: string[]): boolean {
  const args = argv.slice(2);
  const first = args[0];
  if (first && SUBCOMMAND_NAMES.has(first)) return false;
  return args.includes('--help') || args.includes('-h');
}

function isRemoveHelp(argv: string[]): boolean {
  const args = argv.slice(2);
  const first = args[0];
  if (first !== 'remove' && first !== 'rm') return false;
  return args.includes('--help') || args.includes('-h');
}

function printRemoveHelp(): void {
  const lines = [
    'Remove skills from on-disk dirs and/or skills-lock.json.',
    '',
    'USAGE skl-x remove [SKILL...] [OPTIONS]',
    '       skl-x rm [SKILL...] [OPTIONS]',
    '',
    'ARGUMENTS',
    '',
    '  SKILL...            One or more skill names. Use "." to target every skill in scope.',
    '',
    'OPTIONS',
    '',
    '  -g, --global         Use global scope (default: false)',
    '  -y, --yes            Skip confirmation prompts (answers yes to both the',
    '                       "Proceed?" and "Clean skills-lock.json?" questions)',
    '                       and the plan; only the summary is printed',
    '  -m, --mode           lg (large, default): plan and summary',
    '                       md (medium), sm (small): one "Executed A/B/C skills" line instead of',
    '                       the summary (.agents/skills / .claude/skills / lock counts)',
    '  -x, --reject         With ".": skill names to keep (space-separated)',
    '      --lock-only      Only remove the skills-lock.json entry',
    '      --agents-only    Only remove from .agents/skills',
    '      --claude-only    Only remove from .claude/skills',
    '',
    'EXAMPLES',
    '',
    '  skl-x rm brainstorming',
    '  skl-x rm brainstorming writing-plans --yes',
    '  skl-x rm .',
    '  skl-x rm . -x web-debug typescript',
    '  skl-x rm . -y -m sm',
    '  skl-x rm brainstorming --agents-only',
    '  skl-x rm brainstorming --lock-only',
  ];
  console.log(lines.join('\n'));
}

function firstPositional(argv: string[]): string | null {
  for (let i = 2; i < argv.length; i++) {
    const tok = argv[i];
    if (!tok) continue;
    if (tok.startsWith('-')) {
      // -p and -a take a value; skip it so we don't confuse a flag value with a positional
      if (tok === '-p' || tok === '--period' || tok === '-a' || tok === '--agent') i++;
      continue;
    }
    return tok;
  }
  return null;
}

function hasSubcommand(argv: string[]): boolean {
  const tok = firstPositional(argv);
  return tok !== null && SUBCOMMAND_NAMES.has(tok);
}

function unknownCommand(argv: string[]): string | null {
  const tok = firstPositional(argv);
  if (!tok) return null;
  if (SUBCOMMAND_NAMES.has(tok)) return null;
  return tok;
}

function isRootVersion(argv: string[]): boolean {
  const args = argv.slice(2);
  const first = args[0];
  if (first && SUBCOMMAND_NAMES.has(first)) return false;
  return args.includes('--version') || args.includes('-v');
}

const main = defineCommand({
  meta: {
    name: 'skl-x',
    version,
    description: 'Audit and manage AI agent skills',
  },
  args: costCommand.args,
  async run({ args }) {
    if (hasSubcommand(process.argv)) return;
    const interactive = process.stdout.isTTY && process.stdin.isTTY;
    if (interactive) {
      const { runPicker } = await import('./commands/picker');
      const status = await runPicker({
        global: (args as { global?: boolean }).global ?? false,
      });
      process.exit(status);
    }
    await costCommand.run?.({
      args,
      cmd: costCommand,
      rawArgs: process.argv.slice(2),
    } as never);
  },
  subCommands: {
    list: listCommand,
    ls: listCommand,
    remove: removeCommand,
    rm: removeCommand,
    cost: costCommand,
    cst: costCommand,
    usage: usageCommand,
    usg: usageCommand,
    completion: completionCommand,
  },
});

(async () => {
  if (raw) {
    if (raw.command === 'install' || raw.command === 'i') {
      console.error(removedInstallMessage(raw.command, raw.args));
      process.exit(1);
    }
    setColorEnabled(detectColorSupport());
    if (raw.command === 'update' || raw.command === 'up')
      process.exit(await runUpdate(raw.args, { version }));
    await maybePrintUpdateNotice(version);
    process.exit(raw.command === 'sln' ? await runSln(raw.args) : await runAdd(raw.args));
  }
  if (isRootHelp(process.argv)) {
    printRootHelp();
    return;
  }
  if (isRemoveHelp(process.argv)) {
    printRemoveHelp();
    return;
  }
  if (isRootVersion(process.argv)) {
    console.log(version);
    return;
  }
  const unknown = unknownCommand(process.argv);
  if (unknown) {
    console.error(`${unknown} - is unknowed, use skl -h for usage`);
    process.exit(1);
  }
  setColorEnabled(detectColorSupport());
  await maybePrintUpdateNotice(version);
  runMain(main);
})();
