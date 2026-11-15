import { defineCommand } from 'citty';
import { cyan, red } from '../utils/ansi';
import { discoverSkills, recordCost, type SkillRecord } from '../utils/discover-skills';
import { scopeHeader, scopeLockPath } from '../utils/scope';
import { formatCost } from '../utils/skill-files';

function inContext(r: SkillRecord): boolean {
  return r.status === 'ok' && !r.disableModelInvocation;
}

function sortRows(records: SkillRecord[]): SkillRecord[] {
  const ok = records.filter(inContext);
  const rest = records.filter((r) => !inContext(r));
  ok.sort(
    (a, b) =>
      (b.frontmatterTokens ?? 0) - (a.frontmatterTokens ?? 0) || a.name.localeCompare(b.name),
  );
  rest.sort((a, b) => a.name.localeCompare(b.name));
  return [...ok, ...rest];
}

export const costCommand = defineCommand({
  meta: {
    description: 'Show ambient context cost (per-skill name + description tokens) sorted desc',
  },
  args: {
    global: { type: 'boolean', alias: 'g', default: false, description: 'Use global scope' },
  },
  run({ args }) {
    const lockPath = scopeLockPath(args.global, process.cwd());
    const map = discoverSkills({ isGlobal: args.global, cwd: process.cwd(), lockPath });
    const rows = sortRows([...map.values()]);
    const total = rows.filter(inContext).reduce((acc, r) => acc + (r.frontmatterTokens ?? 0), 0);

    console.log(scopeHeader(args.global));

    if (rows.length === 0) {
      console.log(`No skills in ${lockPath}`);
      return;
    }

    const nameWidth = Math.max(...rows.map((r) => r.name.length));
    // disable-model-invocation: not in Claude Code's always-loaded context, shown as '-'
    const tokenCells = rows.map((r) => formatCost(recordCost(r)));
    const tokenWidth = Math.max(...tokenCells.map((c) => c.length));
    rows.forEach((r, i) => {
      const tokenCell = tokenCells[i] ?? '';
      const suffix = r.status === 'missing' ? `  ${red('missing')}` : '';
      const namePad = ' '.repeat(nameWidth - r.name.length);
      const tokenPad = ' '.repeat(tokenWidth - tokenCell.length);
      console.log(`${cyan(r.name)}${namePad}  ${tokenPad}${tokenCell}${suffix}`);
    });
    console.log(
      `Total: ${formatCost(total)} across ${rows.length} skills  ·  method: chars/3, name+description`,
    );
  },
});
