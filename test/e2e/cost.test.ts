import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { copyFixture, run, runWithColor } from './helpers';

let COST_DIR = '';
beforeAll(() => {
  COST_DIR = copyFixture('cost');
});
afterAll(() => rmSync(COST_DIR, { recursive: true, force: true }));

describe('skl cost', () => {
  it('in a subdirectory of a git repo measures the skills of the repo root', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'skl-cost-sub-'));
    try {
      cpSync(COST_DIR, tmp, { recursive: true });
      mkdirSync(join(tmp, '.git'));
      mkdirSync(join(tmp, 'sub'));
      const { stdout, exitCode } = run(['cost'], join(tmp, 'sub'));
      expect(exitCode).toBe(0);
      expect(stdout).toContain('Total: ~17 tok across 3 skills');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('lists per-skill cost sorted desc without a verdict', () => {
    const { stdout, exitCode } = run(['cost'], COST_DIR);
    expect(exitCode).toBe(0);
    // skill-foo has frontmatter, comes before missing/no-frontmatter rows
    const lines = stdout.split('\n').filter((l) => l.trim().length);
    const brainIdx = lines.findIndex((l) => l.startsWith('skill-foo'));
    const noFmIdx = lines.findIndex((l) => l.startsWith('no-fm'));
    const ghostIdx = lines.findIndex((l) => l.startsWith('ghost-skill'));
    expect(brainIdx).toBeLessThan(noFmIdx);
    expect(brainIdx).toBeLessThan(ghostIdx);
    // 'skill-foo' + 'Tiny test description for token counting.' = 51 chars -> 17 tok
    expect(stdout).toMatch(/skill-foo\s+~17 tok/);
    expect(stdout).toMatch(/no-fm\s+\(no frontmatter\)/);
    expect(stdout).toMatch(/ghost-skill\s+~\? tok\s+missing/);
    // cost is right-aligned to the widest cell, '(no frontmatter)'
    expect(stdout).toMatch(/^skill-foo {13}~17 tok$/m);
    expect(stdout).toMatch(/^ghost-skill {12}~\? tok {2}missing$/m);
    expect(stdout).toContain('Total: ~17 tok across 3 skills  ·  method:');
    expect(stdout).not.toMatch(/keep it lean|cleanup|clean it up/);
  });

  it('bare skl with no args runs cost', () => {
    const { stdout, exitCode } = run([], COST_DIR);
    expect(exitCode).toBe(0);
    // cost format - NOT the old summary "Total: N skills ~M tok" format
    expect(stdout).toMatch(/Total: ~\d+ tok across 3 skills/);
    // summary printed both Global + Local sections; cost only prints one header
    expect(stdout).not.toContain('Global scope');
  });

  it('prints no blank lines: header first, Total right after the rows', () => {
    const { stdout, exitCode } = run(['cost'], COST_DIR);
    expect(exitCode).toBe(0);
    const lines = stdout.trimEnd().split('\n');
    expect(lines[0]).toBe('Project scope');
    expect(lines).not.toContain('');
    expect(lines.at(-1)).toMatch(/^Total:/);
  });

  it('shows disable-model-invocation skills as "-" and leaves them out of Total', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'skl-cost-dmi-'));
    try {
      writeFileSync(join(tmp, 'skills-lock.json'), JSON.stringify({ skills: {} }));
      const write = (name: string, fm: string) => {
        mkdirSync(join(tmp, '.claude', 'skills', name), { recursive: true });
        writeFileSync(join(tmp, '.claude', 'skills', name, 'SKILL.md'), `---\n${fm}\n---\n`);
      };
      // 'auto' + 'Does it.' = 12 chars -> 4 tok
      write('auto', 'name: auto\ndescription: Does it.');
      write(
        'manual',
        'name: manual\ndescription: Long manual text\ndisable-model-invocation: true',
      );
      const { stdout, exitCode } = run(['cost'], tmp);
      expect(exitCode).toBe(0);
      const lines = stdout.trimEnd().split('\n');
      expect(lines[1]).toMatch(/^auto\s+~4 tok$/);
      expect(lines[2]).toMatch(/^manual\s+-$/);
      expect(stdout).toMatch(/Total: ~4 tok across 2 skills/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('prints the scope header in bold with FORCE_COLOR', () => {
    const { stdout } = runWithColor(['cost'], COST_DIR);
    expect(stdout.split('\n')[0]).toBe('\x1b[1mProject scope\x1b[22m');
  });

  it('cst alias works', () => {
    const { stdout, exitCode } = run(['cst'], COST_DIR);
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/Total: ~\d+ tok across 3 skills/);
  });

  it('summary includes method label', () => {
    const { stdout, exitCode } = run(['cost'], COST_DIR);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('·  method: chars/3, name+description');
  });
});
