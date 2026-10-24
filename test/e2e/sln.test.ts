import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { run } from './helpers';

let TMP = '';
let PROJ = '';

function seedSkill(root: string, name: string, internal = false): void {
  mkdirSync(join(root, 'skills', name), { recursive: true });
  const meta = internal ? 'metadata:\n  internal: true\n' : '';
  writeFileSync(join(root, 'skills', name, 'SKILL.md'), `---\nname: ${name}\n${meta}---\n`);
}

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), 'skl-link-e2e-'));
  PROJ = join(TMP, 'proj');
  const clone = join(TMP, 'clone');
  seedSkill(clone, 'tdd');
  seedSkill(clone, 'vitest');
  seedSkill(clone, 'hidden', true);
  mkdirSync(join(PROJ, '.agents/skills/tdd'), { recursive: true });
  writeFileSync(join(PROJ, '.agents/skills/tdd/SKILL.md'), 'copy from npx skills add');
});

afterEach(() => rmSync(TMP, { recursive: true, force: true }));

describe('skl sln', () => {
  it('lg (default) prints the progress line, a table and a summary, no links or skips', () => {
    const { stdout, exitCode } = run(['sln', '../clone', '-a', 'codex', 'claude-code', '-y'], PROJ);
    expect(exitCode).toBe(0);
    expect(stdout).toBe(
      [
        'Symlinking 2 skills from ../clone to Project scope ██████████ 100%',
        'skill     .agents    .claude  skills-lock.json    cost',
        'tdd     symlinked  symlinked         -          ~1 tok',
        'vitest  symlinked  symlinked         -          ~2 tok',
        'Symlinked 2 skills to Project scope · tdd vitest',
        '',
      ].join('\n'),
    );
    for (const dir of ['.agents/skills', '.claude/skills']) {
      expect(readlinkSync(join(PROJ, dir, 'tdd'))).toBe('../../../clone/skills/tdd');
      expect(lstatSync(join(PROJ, dir, 'vitest')).isSymbolicLink()).toBe(true);
      expect(existsSync(join(PROJ, dir, 'hidden'))).toBe(false);
    }
  });

  it('-m md prints the same as lg, -m sm the summary only', () => {
    const md = run(['sln', '../clone', '-s', 'vitest', ' tdd', '-y', '-m', 'md'], PROJ);
    expect(md.stdout).toBe(
      [
        'Symlinking 1 skill from ../clone to Project scope ██████████ 100%',
        'skill     .agents    .claude  skills-lock.json    cost',
        'vitest  symlinked  symlinked         -          ~2 tok',
        'Symlinked 1 skill to Project scope · vitest',
        '',
      ].join('\n'),
    );
    const sm = run(['sln', '../clone', '-s', 'tdd', '-y', '-m', 'sm'], PROJ);
    expect(sm.exitCode).toBe(0);
    expect(sm.stdout).toBe('Symlinked 1 skill to Project scope · tdd\n');
  });

  it('prints "No skills to symlink" alone when nothing is selected', () => {
    const none = run(['sln', '../clone', '-x', 'tdd', 'vitest', '-y'], PROJ);
    expect(none.exitCode).toBe(0);
    expect(none.stdout).toBe('No skills to symlink in ../clone.\n');
    const { stdout, exitCode } = run(['sln', '../clone', '-s', ' tdd', '-y', '-m', 'sm'], PROJ);
    expect(exitCode).toBe(0);
    expect(stdout).toBe('No skills to symlink in ../clone.\n');
    expect(lstatSync(join(PROJ, '.agents/skills/tdd')).isDirectory()).toBe(true);
    expect(existsSync(join(PROJ, '.claude'))).toBe(false);
  });

  it('-x skips the listed skills', () => {
    const { exitCode } = run(['sln', '../clone', '-x', 'tdd', '-y'], PROJ);
    expect(exitCode).toBe(0);
    expect(existsSync(join(PROJ, '.claude/skills/vitest'))).toBe(true);
    expect(lstatSync(join(PROJ, '.agents/skills/tdd')).isDirectory()).toBe(true);
  });

  it('does not touch skills-lock.json', () => {
    const lock = '{\n  "version": 1,\n  "skills": {}\n}\n';
    writeFileSync(join(PROJ, 'skills-lock.json'), lock);
    expect(run(['sln', '../clone', '-s', 'tdd', '-y'], PROJ).exitCode).toBe(0);
    expect(readFileSync(join(PROJ, 'skills-lock.json'), 'utf8')).toBe(lock);
  });

  it('without -y and no TTY the copy stays (createConfirmer reads EOF as no)', () => {
    const { stdout, exitCode } = run(['sln', '../clone', '-s', 'tdd'], PROJ);
    expect(exitCode).toBe(1);
    expect(stdout).toContain('.agents/skills/tdd - folder');
    expect(stdout).toContain('Replace 1 existing skill?');
    expect(lstatSync(join(PROJ, '.agents/skills/tdd')).isDirectory()).toBe(true);
  });

  it('-a goes through unmerged and -g is rejected', () => {
    const ok = run(['sln', '../clone', '-s', 'tdd', '-a', 'claude-code', 'codex', '-y'], PROJ);
    expect(ok.exitCode).toBe(0);
    const global = run(['-g', 'sln', '../clone', '-s', 'tdd'], PROJ);
    expect(global.exitCode).toBe(1);
    expect(global.stderr).toContain('-g/--global is not supported yet');
  });
});

describe('removed commands', () => {
  it.each([['sl'], ['sym'], ['symlink'], ['cs'], ['us']])('skl %s exits 1', (cmd) => {
    const { exitCode, stderr } = run([cmd, '../clone', '-s', 'tdd', '-y'], PROJ);
    expect(exitCode).toBe(1);
    expect(stderr).toContain(`${cmd} - is unknowed`);
    expect(existsSync(join(PROJ, '.claude'))).toBe(false);
  });

  it('takes the skills folder itself as <path>', () => {
    const { stdout, exitCode } = run(['sln', '../clone/skills', '-s', 'vitest', '-y', '-m', 'sm'], PROJ);
    expect(exitCode).toBe(0);
    expect(stdout).toBe('Symlinked 1 skill to Project scope · vitest\n');
    expect(readlinkSync(join(PROJ, '.agents/skills/vitest'))).toBe('../../../clone/skills/vitest');
  });

  it('root help lists add, sln and the short aliases only', () => {
    const { stdout } = run(['-h'], PROJ);
    expect(stdout).toContain('  add  ');
    expect(stdout).toContain('  sln  ');
    expect(stdout).toContain('cost, cst ');
    expect(stdout).toContain('usage, usg ');
    expect(stdout).not.toMatch(/install, i|symlink, sym|\bcs\b|\bus\b/);
  });
});
