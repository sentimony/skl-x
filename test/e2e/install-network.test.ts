import { existsSync, lstatSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { run } from './helpers';

// Real `npx skills add` against GitHub: opt-in so CI does not depend on the network.
describe.skipIf(!process.env.SKL_X_E2E_NETWORK)('skl add (network)', () => {
  let proj = '';

  beforeEach(() => {
    proj = mkdtempSync(join(tmpdir(), 'skl-install-network-'));
  });

  afterEach(() => rmSync(proj, { recursive: true, force: true }));

  it('installs cross-review from sentimony/skills for codex and claude-code', () => {
    const { stdout, stderr, exitCode } = run(
      ['add', 'sentimony/skills', '-s', 'cross-review', '-a', 'codex', 'claude-code', '-y', '-m', 'md'],
      proj,
    );
    expect(exitCode, stdout + stderr).toBe(0);
    const lines = stdout.trimEnd().split('\n');
    expect(lines[0]).toBe('Installing 1 skill from https://github.com/sentimony/skills to Project scope ██████████ 100%');
    expect(lines.at(-1)).toBe('Project scope · +1 skill installed · cross-review');
    expect(lines[2]).toMatch(/^cross-review {2}universal {2}symlinked {9}\+ +~[\d,]+ tok$/);
    expect(existsSync(join(proj, '.agents/skills/cross-review/SKILL.md'))).toBe(true);
    expect(lstatSync(join(proj, '.claude/skills/cross-review')).isSymbolicLink()).toBe(true);
    expect(readFileSync(join(proj, 'skills-lock.json'), 'utf8')).toContain('"cross-review"');
  }, 180_000);
});
