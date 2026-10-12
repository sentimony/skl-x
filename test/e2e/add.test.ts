import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { run } from './helpers';

let TMP = '';
let ARGS_FILE = '';
let ENV: Record<string, string> = {};

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), 'skl-install-e2e-'));
  const bin = join(TMP, 'bin');
  mkdirSync(bin);
  ARGS_FILE = join(TMP, 'npx-args.txt');
  writeFileSync(
    join(bin, 'npx'),
    [
      '#!/bin/sh',
      'printf \'%s\\n\' "$@" > "$NPX_ARGS_FILE"',
      'echo NOISE',
      'if [ -n "$NPX_SEED" ]; then',
      '  mkdir -p ".agents/skills/$NPX_SEED" .claude/skills',
      '  printf -- "---\\nname: %s\\n---\\n" "$NPX_SEED" > ".agents/skills/$NPX_SEED/SKILL.md"',
      '  ln -s "../../.agents/skills/$NPX_SEED" ".claude/skills/$NPX_SEED"',
      '  exit 0',
      'fi',
      'exit 3',
      '',
    ].join('\n'),
  );
  chmodSync(join(bin, 'npx'), 0o755);
  ENV = { PATH: `${bin}:${process.env.PATH ?? ''}`, NPX_ARGS_FILE: ARGS_FILE };
});

afterEach(() => rmSync(TMP, { recursive: true, force: true }));

function npxArgs(): string[] {
  return readFileSync(ARGS_FILE, 'utf8').trimEnd().split('\n');
}

describe('skl add', () => {
  it('passes -s and -a with several values to npx skills add unchanged', () => {
    const { exitCode } = run(
      ['add', 'sentimony/skills', '-s', 'cross-review', 'tdd', '-a', 'codex', 'claude-code', '-y'],
      TMP,
      ENV,
    );
    expect(exitCode).toBe(3);
    expect(npxArgs()).toEqual([
      '-y',
      'skills',
      'add',
      'sentimony/skills',
      '-s',
      'cross-review',
      'tdd',
      '-a',
      'codex',
      'claude-code',
      '-y',
    ]);
  });

  it.each([
    [['i', 'sentimony/skills', '-y'], 'skl i was removed in 0.4.6, use skl add'],
    [['install', 'sentimony/skills', '-l'], 'skl install was removed in 0.4.6, use skl add'],
    [['i', '-ln', '../clone', '-y'], 'skl i -ln was removed in 0.4.6, use skl sln'],
    [['-g', 'install', '--link', '../clone'], 'skl install --link was removed in 0.4.6, use skl sln'],
    [['add', '-ln', '../clone', '-y'], 'skl add: -ln/--link was removed in 0.4.6, use skl sln'],
    [['add', '../clone', '--link'], 'skl add: -ln/--link was removed in 0.4.6, use skl sln'],
  ])('%j exits 1 without running npx', (args, message) => {
    const { stdout, stderr, exitCode } = run(args, TMP, ENV);
    expect(exitCode).toBe(1);
    expect(stdout).toBe('');
    expect(stderr.trim()).toBe(message);
    expect(existsSync(ARGS_FILE)).toBe(false);
  });

  it('moves a root -g after the command', () => {
    run(['-g', 'add', 'sentimony/skills'], TMP, ENV);
    expect(npxArgs()).toEqual(['-y', 'skills', 'add', '-g', 'sentimony/skills']);
  });

  it('an option value equal to a raw command name does not dispatch it', () => {
    const a = run(['--since', 'add', 'usage'], TMP, ENV);
    const b = run(['usage', '--since', 'sln'], TMP, ENV);
    expect(existsSync(ARGS_FILE)).toBe(false);
    for (const r of [a, b]) expect(r.stderr).not.toMatch(/skl (add|sln)|Unknown option/);
  });

  it('-m md hides the npx output and prints the progress line, a table and a summary', () => {
    const { stdout, exitCode } = run(
      ['add', 'sentimony/skills', '-s', 'cross-review', '-a', 'codex', 'claude-code', '-y', '-m', 'md'],
      TMP,
      { ...ENV, NPX_SEED: 'cross-review' },
    );
    expect(exitCode).toBe(0);
    expect(stdout).toBe(
      [
        'Installing 1 skill from https://github.com/sentimony/skills ██████████ 100%',
        'skill         .agents    .claude    skills-lock.json  cost',
        'cross-review  universal  symlinked  -                 ~4 tok',
        'Installed 1 skill · cross-review',
        '',
      ].join('\n'),
    );
    expect(npxArgs()).toEqual([
      '-y',
      'skills',
      'add',
      'sentimony/skills',
      '-s',
      'cross-review',
      '-a',
      'codex',
      'claude-code',
      '-y',
    ]);
  });

  it('-m md prints the npx output when npx fails', () => {
    const { stdout, exitCode } = run(['add', 'sentimony/skills', '-y', '-m', 'md'], TMP, ENV);
    expect(exitCode).toBe(3);
    expect(stdout).toContain('NOISE');
  });

  it('-h prints its own help', () => {
    const { stdout, exitCode } = run(['add', '-h'], TMP, ENV);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('USAGE skl-x add');
    expect(stdout).not.toContain('-ln');
  });

  it('lg (default) shows the npx output, then the md output', () => {
    const { stdout, exitCode } = run(
      ['add', 'sentimony/skills', '-s', 'cross-review', '-a', 'codex', 'claude-code', '-y'],
      TMP,
      { ...ENV, NPX_SEED: 'cross-review' },
    );
    expect(exitCode).toBe(0);
    expect(stdout).toBe(
      [
        'NOISE',
        'Installing 1 skill from https://github.com/sentimony/skills ██████████ 100%',
        'skill         .agents    .claude    skills-lock.json  cost',
        'cross-review  universal  symlinked  -                 ~4 tok',
        'Installed 1 skill · cross-review',
        '',
      ].join('\n'),
    );
  });

  it('-m sm prints the summary line only, and needs -y', () => {
    const ok = run(['add', 'sentimony/skills', '-s', 'cross-review', '-y', '-m', 'sm'], TMP, {
      ...ENV,
      NPX_SEED: 'cross-review',
    });
    expect(ok.exitCode).toBe(0);
    expect(ok.stdout).toBe('Installed 1 skill · cross-review\n');
    const noYes = run(['add', 'sentimony/skills', '-m', 'sm'], TMP, ENV);
    expect(noYes.exitCode).toBe(1);
    expect(noYes.stderr).toContain('--mode sm needs -y/--yes');
  });
});
