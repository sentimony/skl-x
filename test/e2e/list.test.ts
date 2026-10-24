import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { copyFixture, run, runWithColor } from './helpers';

let LOCK_DIR = '';
let EMPTY = '';
beforeAll(() => {
  LOCK_DIR = copyFixture('lock');
  EMPTY = copyFixture('list/empty-local');
});
afterAll(() => {
  rmSync(LOCK_DIR, { recursive: true, force: true });
  rmSync(EMPTY, { recursive: true, force: true });
});
const CLI = resolve(process.cwd(), 'dist', 'cli.js');

let tmp = '';
afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  tmp = '';
});

// a: real in .agents + symlink in .claude + lock; b: real in .claude; c: dangling in .claude; d: lock only
function seedAllStates(): string {
  tmp = mkdtempSync(join(tmpdir(), 'skl-ls-states-'));
  writeFileSync(join(tmp, 'skills-lock.json'), JSON.stringify({ skills: { a: {}, d: {} } }));
  mkdirSync(join(tmp, '.agents', 'skills', 'a'), { recursive: true });
  writeFileSync(join(tmp, '.agents', 'skills', 'a', 'SKILL.md'), '---\nname: a\n---\n');
  mkdirSync(join(tmp, '.claude', 'skills', 'b'), { recursive: true });
  writeFileSync(join(tmp, '.claude', 'skills', 'b', 'SKILL.md'), '---\nname: b\n---\n');
  symlinkSync('../../.agents/skills/a', join(tmp, '.claude', 'skills', 'a'));
  symlinkSync('../../.agents/skills/gone', join(tmp, '.claude', 'skills', 'c'));
  return tmp;
}

describe('skl ls', () => {
  it('-m sm prints one summary line', () => {
    expect(run(['ls', '-m', 'sm'], LOCK_DIR).stdout).toBe('Project scope · 3 skills · ~24 tok\n');
    expect(run(['ls', '--mode=small'], LOCK_DIR).stdout).toBe('Project scope · 3 skills · ~24 tok\n');
  });

  it('-m sm on an empty scope says "No skills"', () => {
    expect(run(['ls', '-m', 'sm'], EMPTY).stdout).toBe('Project scope · No skills\n');
  });

  it('-g -m sm on an empty global scope says "No skills"', () => {
    tmp = mkdtempSync(join(tmpdir(), 'skl-ls-home-'));
    expect(run(['ls', '-g', '-m', 'sm'], EMPTY, { HOME: tmp }).stdout).toBe('Global scope · No skills\n');
  });

  it('-m md prints the table', () => {
    expect(run(['ls', '-m', 'md'], LOCK_DIR).stdout).toBe(run(['ls'], LOCK_DIR).stdout);
  });

  it('rejects an unknown mode, also with --names', () => {
    for (const args of [['ls', '-m', 'loud'], ['ls', '--names', '-m', 'loud']]) {
      const r = run(args, LOCK_DIR);
      expect(r.exitCode).toBe(1);
      expect(r.stderr).toContain('skl ls: unknown mode "loud"');
    }
  });

  it('in a subdirectory of a git repo lists the skills of the repo root', () => {
    tmp = mkdtempSync(join(tmpdir(), 'skl-ls-sub-'));
    cpSync(LOCK_DIR, tmp, { recursive: true });
    mkdirSync(join(tmp, '.git'));
    mkdirSync(join(tmp, 'pkg', 'src'), { recursive: true });
    expect(run(['ls', '--names'], join(tmp, 'pkg', 'src')).stdout).toBe(
      'skill-bar\nskill-baz\nskill-foo\n',
    );
  });

  it('prints one table row per skill with a total row', () => {
    const { stdout, exitCode } = run(['ls'], LOCK_DIR);
    expect(exitCode).toBe(0);
    expect(stdout).toBe(
      [
        'Project scope',
        'skill      .agents  .claude  skills-lock.json     cost',
        'skill-bar        -   copied         +          ~11 tok',
        'skill-baz        -        -         +           ~? tok',
        'skill-foo        -   copied         +          ~13 tok',
        '3 skills         0        2         3          ~24 tok',
        '',
      ].join('\n'),
    );
  });

  it('list alias works', () => {
    expect(run(['list'], LOCK_DIR).stdout).toContain('skill-bar        -   copied         +          ~11 tok');
  });

  it('shows every install state and no "not in lock" lines', () => {
    const { stdout, exitCode } = run(['ls'], seedAllStates());
    expect(exitCode).toBe(0);
    expect(stdout).toBe(
      [
        'Project scope',
        'skill       .agents    .claude  skills-lock.json    cost',
        'a         universal  symlinked         +          ~0 tok',
        'b                 -     copied         -          ~0 tok',
        'c                 -     broken         -          ~? tok',
        'd                 -          -         +          ~? tok',
        '4 skills          1          3         2          ~0 tok',
        '',
      ].join('\n'),
    );
    expect(stdout).not.toContain('not in lock');
  });

  it('colors cells and the orphan lock mark with FORCE_COLOR', () => {
    const r = runWithColor(['ls'], seedAllStates());
    expect(r.exitCode).toBe(0);
    expect(r.stdout.split('\n')[0]).toBe('\x1b[1mProject scope\x1b[22m');
    expect(r.stdout).toContain('\x1b[1mskill\x1b[22m');
    expect(r.stdout).toContain('\x1b[32muniversal\x1b[0m');
    expect(r.stdout).toContain('\x1b[33msymlinked\x1b[0m');
    expect(r.stdout).toContain('\x1b[32mcopied\x1b[0m');
    expect(r.stdout).toContain('\x1b[31mbroken\x1b[0m');
    const lines = r.stdout.split('\n');
    expect(lines.find((l) => l.startsWith('\x1b[36md\x1b[0m '))).toMatch(/\x1b\[31m\+\x1b\[0m +~\? tok$/);
    expect(lines.find((l) => l.startsWith('\x1b[36ma\x1b[0m '))).toMatch(/\x1b\[32m\+\x1b\[0m +~0 tok$/);
  });

  it('prints "No skills in scope." for an empty scope', () => {
    const r = run(['ls'], EMPTY);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe('Project scope\nNo skills in scope.\n');
  });

  it('global scope uses the .agents/.skill-lock.json column label', () => {
    tmp = mkdtempSync(join(tmpdir(), 'skl-ls-global-'));
    mkdirSync(join(tmp, '.agents'), { recursive: true });
    writeFileSync(join(tmp, '.agents', '.skill-lock.json'), JSON.stringify({ skills: { foo: {} } }));
    const r = spawnSync(process.execPath, [CLI, 'ls', '-g'], {
      encoding: 'utf8',
      cwd: EMPTY,
      env: { ...process.env, HOME: tmp, SKL_X_NO_UPDATE_CHECK: '1', NO_COLOR: '1' },
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(
      [
        'Global scope',
        'skill    .agents  .claude  .agents/.skill-lock.json    cost',
        'foo            -        -             +              ~? tok',
        '1 skill        0        0             1              ~0 tok',
        '',
      ].join('\n'),
    );
  });

  it('--names prints one name per line, sorted, no header, no colors', () => {
    const r = runWithColor(['ls', '--names'], LOCK_DIR);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe('skill-bar\nskill-baz\nskill-foo\n');
  });

  it('--names emits nothing when scope is empty', () => {
    const r = run(['ls', '--names'], EMPTY);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe('');
  });
});
