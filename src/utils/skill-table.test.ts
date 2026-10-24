// src/utils/skill-table.test.ts
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { setColorEnabled } from './ansi';
import { collectRows, renderSkillTable, type SkillRow, scopeTotalLine } from './skill-table';

const ROWS: SkillRow[] = [
  { name: 'cross-review', agents: 'real', claude: 'symlink', inLock: true, cost: 262 },
  { name: 'echarts', claude: 'real', inLock: false, cost: 'hidden' },
  { name: 'old-skill', inLock: true, cost: 'missing' },
  {
    name: 'webapp-debugger',
    agents: 'symlink',
    claude: 'broken',
    inLock: false,
    cost: 'no-frontmatter',
  },
];

afterEach(() => setColorEnabled(false));

describe('renderSkillTable', () => {
  it('renders the spec table with a total row', () => {
    expect(renderSkillTable(ROWS, { lockLabel: 'skills-lock.json', total: true })).toEqual([
      'skill              .agents    .claude  skills-lock.json              cost',
      'cross-review     universal  symlinked         +                  ~262 tok',
      'echarts                  -     copied         -                         -',
      'old-skill                -          -         +                    ~? tok',
      'webapp-debugger  symlinked     broken         -          (no frontmatter)',
      '4 skills                 2          3         2                  ~262 tok',
    ]);
  });

  it('omits the total row and uses the given lock label', () => {
    const rows: SkillRow[] = [
      { name: 'tdd', agents: 'symlink', claude: 'symlink', inLock: false, cost: 262 },
    ];
    expect(renderSkillTable(rows, { lockLabel: '.agents/.skill-lock.json', total: false })).toEqual(
      [
        'skill    .agents    .claude  .agents/.skill-lock.json      cost',
        'tdd    symlinked  symlinked             -              ~262 tok',
      ],
    );
  });

  it('says "1 skill" in the total row', () => {
    const rows: SkillRow[] = [{ name: 'a', inLock: true, cost: 'missing' }];
    expect(renderSkillTable(rows, { lockLabel: 'skills-lock.json', total: true }).at(-1)).toBe(
      '1 skill        0        0         1          ~0 tok',
    );
  });

  it('colors cells, bolds the header and keeps alignment by visible width', () => {
    setColorEnabled(true);
    const lines = renderSkillTable(ROWS, { lockLabel: 'skills-lock.json', total: false });
    expect(lines[0]).toContain('\x1b[1mskill\x1b[22m');
    expect(lines[1]).toBe(
      '\x1b[36mcross-review\x1b[0m     \x1b[32muniversal\x1b[0m  \x1b[33msymlinked\x1b[0m         \x1b[32m+\x1b[0m                  ~262 tok',
    );
    expect(lines[2]).toContain('\x1b[32mcopied\x1b[0m');
    expect(lines[2]).toContain('\x1b[33m-\x1b[0m');
    expect(lines[3]).toBe(
      '\x1b[36mold-skill\x1b[0m                -          -         \x1b[31m+\x1b[0m                    ~? tok',
    );
    expect(lines[4]).toContain('\x1b[31mbroken\x1b[0m');
  });

  it('groups thousands in the cost cells', () => {
    const rows: SkillRow[] = [
      { name: 'a', agents: 'real', claude: 'symlink', inLock: true, cost: 2000 },
      { name: 'b', agents: 'real', claude: 'symlink', inLock: true, cost: 1333 },
    ];
    expect(renderSkillTable(rows, { lockLabel: 'skills-lock.json', total: true })).toEqual([
      'skill       .agents    .claude  skills-lock.json        cost',
      'a         universal  symlinked         +          ~2,000 tok',
      'b         universal  symlinked         +          ~1,333 tok',
      '2 skills          2          2         2          ~3,333 tok',
    ]);
  });
});

describe('scopeTotalLine', () => {
  it('prints the scope, signed count and grouped cost', () => {
    expect(scopeTotalLine(false, 30, 3333, '-')).toBe('Project scope · -30 skills · ~3,333 tok');
    expect(scopeTotalLine(true, 1, 74)).toBe('Global scope · 1 skill · ~74 tok');
  });

  it('says "No skills" for zero', () => {
    expect(scopeTotalLine(true, 0, 0, '-')).toBe('Global scope · No skills');
  });
});

describe('collectRows', () => {
  let tmp = '';
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it('reads install types from both roots, dedupes and sorts names', () => {
    tmp = mkdtempSync(join(tmpdir(), 'skl-table-'));
    const agents = join(tmp, '.agents', 'skills');
    const claude = join(tmp, '.claude', 'skills');
    mkdirSync(join(agents, 'b'), { recursive: true });
    writeFileSync(join(agents, 'b', 'SKILL.md'), '---\nname: b\n---\n');
    mkdirSync(claude, { recursive: true });
    symlinkSync('../../.agents/skills/b', join(claude, 'b'));
    symlinkSync('../../.agents/skills/gone', join(claude, 'a'));
    expect(collectRows(['b', 'a', 'b', 'c'], { agents, claude }, new Set(['c']))).toEqual([
      { name: 'a', agents: undefined, claude: 'broken', inLock: false, cost: 'missing' },
      { name: 'b', agents: 'real', claude: 'symlink', inLock: false, cost: 0 },
      { name: 'c', agents: undefined, claude: undefined, inLock: true, cost: 'missing' },
    ]);
  });

  it('reads the cost from .claude before .agents', () => {
    tmp = mkdtempSync(join(tmpdir(), 'skl-table-'));
    const agents = join(tmp, '.agents', 'skills');
    const claude = join(tmp, '.claude', 'skills');
    for (const [root, description] of [
      [agents, 'x'.repeat(30)],
      [claude, 'x'.repeat(60)],
    ] as const) {
      mkdirSync(join(root, 'k'), { recursive: true });
      writeFileSync(
        join(root, 'k', 'SKILL.md'),
        `---\nname: k\ndescription: ${description}\n---\n`,
      );
    }
    // (1 + 60) / 3 from .claude, not (1 + 30) / 3 from .agents
    expect(collectRows(['k'], { agents, claude }, new Set())[0]?.cost).toBe(20);
  });
});
