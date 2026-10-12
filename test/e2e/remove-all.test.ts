import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CLI = resolve(__dirname, '..', '..', 'dist', 'cli.js');

describe('skl rm .', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'skl-rm-all-'));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  function seed3() {
    writeFileSync(
      join(tmp, 'skills-lock.json'),
      JSON.stringify({ skills: { foo: {}, bar: {}, baz: {} } }),
    );
    for (const name of ['foo', 'bar', 'baz']) {
      mkdirSync(join(tmp, '.claude', 'skills', name), { recursive: true });
      writeFileSync(join(tmp, '.claude', 'skills', name, 'SKILL.md'), '---\nname: x\n---\nbody');
    }
  }

  it('wipes all on-disk skills and lock entries with --yes', () => {
    seed3();
    const r = spawnSync(process.execPath, [CLI, 'rm', '.', '--yes'], {
      cwd: tmp,
      encoding: 'utf8',
      env: { ...process.env, SKL_X_NO_UPDATE_CHECK: '1' },
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('3 skills');
    expect(existsSync(join(tmp, '.claude', 'skills', 'foo'))).toBe(false);
    expect(existsSync(join(tmp, '.claude', 'skills', 'bar'))).toBe(false);
    expect(existsSync(join(tmp, '.claude', 'skills', 'baz'))).toBe(false);
    const lock = JSON.parse(readFileSync(join(tmp, 'skills-lock.json'), 'utf8'));
    expect(lock.skills).toEqual({});
  });

  it('y then n removes all disk dirs but keeps all lock entries', () => {
    seed3();
    const r = spawnSync(process.execPath, [CLI, 'rm', '.'], {
      cwd: tmp,
      encoding: 'utf8',
      input: 'y\nn\n',
      env: { ...process.env, SKL_X_NO_UPDATE_CHECK: '1' },
    });
    expect(r.status).toBe(0);
    expect(existsSync(join(tmp, '.claude', 'skills', 'foo'))).toBe(false);
    const lock = JSON.parse(readFileSync(join(tmp, 'skills-lock.json'), 'utf8'));
    expect(Object.keys(lock.skills).sort()).toEqual(['bar', 'baz', 'foo']);
  });

  it('rejects positional names alongside .', () => {
    seed3();
    const r = spawnSync(process.execPath, [CLI, 'rm', '.', 'foo', '--yes'], {
      cwd: tmp,
      encoding: 'utf8',
      env: { ...process.env, SKL_X_NO_UPDATE_CHECK: '1' },
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('mutually exclusive');
  });

  it('. on empty scope says "No skills to remove"', () => {
    writeFileSync(join(tmp, 'skills-lock.json'), JSON.stringify({ skills: {} }));
    const r = spawnSync(process.execPath, [CLI, 'rm', '.', '--yes'], {
      cwd: tmp,
      encoding: 'utf8',
      env: { ...process.env, SKL_X_NO_UPDATE_CHECK: '1' },
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('No skills to remove');
  });

  it('-x keeps rejected skill, removes the rest from disk and lock', () => {
    seed3();
    const r = spawnSync(process.execPath, [CLI, 'rm', '.', '-x', 'foo', '--yes'], {
      cwd: tmp,
      encoding: 'utf8',
      env: { ...process.env, SKL_X_NO_UPDATE_CHECK: '1' },
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('2 skills');
    expect(existsSync(join(tmp, '.claude', 'skills', 'foo', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(tmp, '.claude', 'skills', 'bar'))).toBe(false);
    expect(existsSync(join(tmp, '.claude', 'skills', 'baz'))).toBe(false);
    const lock = JSON.parse(readFileSync(join(tmp, 'skills-lock.json'), 'utf8'));
    expect(Object.keys(lock.skills)).toEqual(['foo']);
  });

  it('--reject accepts multiple space-separated names', () => {
    seed3();
    const r = spawnSync(process.execPath, [CLI, 'rm', '.', '--reject', 'foo', 'bar', '--yes'], {
      cwd: tmp,
      encoding: 'utf8',
      env: { ...process.env, SKL_X_NO_UPDATE_CHECK: '1' },
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('1 skill');
    expect(existsSync(join(tmp, '.claude', 'skills', 'foo', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(tmp, '.claude', 'skills', 'bar', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(tmp, '.claude', 'skills', 'baz'))).toBe(false);
    const lock = JSON.parse(readFileSync(join(tmp, 'skills-lock.json'), 'utf8'));
    expect(Object.keys(lock.skills).sort()).toEqual(['bar', 'foo']);
  });

  it('-x with positional skill names is rejected', () => {
    seed3();
    const r = spawnSync(process.execPath, [CLI, 'rm', 'foo', '-x', 'bar', '--yes'], {
      cwd: tmp,
      encoding: 'utf8',
      env: { ...process.env, SKL_X_NO_UPDATE_CHECK: '1' },
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('--reject');
  });

  it('-x without values is rejected', () => {
    seed3();
    const r = spawnSync(process.execPath, [CLI, 'rm', '.', '-x', '--yes'], {
      cwd: tmp,
      encoding: 'utf8',
      env: { ...process.env, SKL_X_NO_UPDATE_CHECK: '1' },
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('--reject');
  });

  it('-x with an unknown skill name is rejected', () => {
    seed3();
    const r = spawnSync(process.execPath, [CLI, 'rm', '.', '-x', 'nope', '--yes'], {
      cwd: tmp,
      encoding: 'utf8',
      env: { ...process.env, SKL_X_NO_UPDATE_CHECK: '1' },
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('nope');
    expect(existsSync(join(tmp, '.claude', 'skills', 'foo', 'SKILL.md'))).toBe(true);
  });

  it('rejecting every skill leaves nothing to remove', () => {
    seed3();
    const r = spawnSync(
      process.execPath,
      [CLI, 'rm', '.', '-x', 'foo', 'bar', 'baz', '--yes'],
      {
        cwd: tmp,
        encoding: 'utf8',
        env: { ...process.env, SKL_X_NO_UPDATE_CHECK: '1' },
      },
    );
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('No skills to remove');
    expect(existsSync(join(tmp, '.claude', 'skills', 'foo', 'SKILL.md'))).toBe(true);
  });

  it('--lock-only wipes only lock entries, keeps disk dirs', () => {
    seed3();
    const r = spawnSync(process.execPath, [CLI, 'rm', '.', '--lock-only', '--yes'], {
      cwd: tmp,
      encoding: 'utf8',
      env: { ...process.env, SKL_X_NO_UPDATE_CHECK: '1' },
    });
    expect(r.status).toBe(0);
    const lock = JSON.parse(readFileSync(join(tmp, 'skills-lock.json'), 'utf8'));
    expect(lock.skills).toEqual({});
    expect(existsSync(join(tmp, '.claude', 'skills', 'foo', 'SKILL.md'))).toBe(true);
  });

  function rmAll(args: string[], input?: string) {
    return spawnSync(process.execPath, [CLI, 'rm', '.', ...args], {
      cwd: tmp,
      encoding: 'utf8',
      input,
      env: { ...process.env, SKL_X_NO_UPDATE_CHECK: '1' },
    });
  }

  it('--yes prints only the summary block, not the plan', () => {
    seed3();
    const r = rmAll(['--yes']);
    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain('will be removed from:');
    expect(r.stdout.startsWith('3 skills bar baz foo removed from:\n')).toBe(true);
  });

  it('-y -m sm prints a single Executed line with per-location counts', () => {
    seed3();
    mkdirSync(join(tmp, '.agents', 'skills', 'foo'), { recursive: true });
    const r = rmAll(['-y', '-m', 'sm']);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('Executed 1/3/3 skills\n');
    expect(existsSync(join(tmp, '.agents', 'skills', 'foo'))).toBe(false);
    expect(existsSync(join(tmp, '.claude', 'skills', 'foo'))).toBe(false);
    const lock = JSON.parse(readFileSync(join(tmp, 'skills-lock.json'), 'utf8'));
    expect(lock.skills).toEqual({});
  });

  it('--mode small and --mode=sm are the long forms of -m sm', () => {
    seed3();
    expect(rmAll(['--yes', '--mode', 'small']).stdout).toBe('Executed 0/3/3 skills\n');
    seed3();
    expect(rmAll(['--yes', '--mode=sm']).stdout).toBe('Executed 0/3/3 skills\n');
  });

  it('-m sm without -y keeps the plan and prompts, replaces only the summary', () => {
    seed3();
    const r = rmAll(['-m', 'sm'], 'y\nn\n');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('will be removed from:');
    expect(r.stdout).toContain('Proceed?');
    expect(r.stdout).not.toContain('3 skills bar baz foo removed from:');
    expect(r.stdout.trimEnd().endsWith('Executed 0/3/0 skills')).toBe(true);
  });

  it('-m sm with --lock-only reports 0 for untouched locations', () => {
    seed3();
    const r = rmAll(['--lock-only', '-y', '-m', 'sm']);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('Executed 0/0/3 skills\n');
    expect(existsSync(join(tmp, '.claude', 'skills', 'foo', 'SKILL.md'))).toBe(true);
  });

  it('-x stops collecting names at -m and "sm" is not a skill name', () => {
    seed3();
    const r = rmAll(['-x', 'foo', '-m', 'sm', '-y']);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('Executed 0/2/2 skills\n');
    expect(existsSync(join(tmp, '.claude', 'skills', 'foo', 'SKILL.md'))).toBe(true);
  });

  it('-m md and --mode medium print the same Executed line as -m sm', () => {
    seed3();
    expect(rmAll(['-y', '-m', 'md']).stdout).toBe('Executed 0/3/3 skills\n');
    seed3();
    expect(rmAll(['-y', '--mode', 'medium']).stdout).toBe('Executed 0/3/3 skills\n');
  });

  it('-m lg prints the summary block as without -m', () => {
    seed3();
    const r = rmAll(['-y', '-m', 'lg']);
    expect(r.status).toBe(0);
    expect(r.stdout.startsWith('3 skills bar baz foo removed from:\n')).toBe(true);
  });

  it('-sm, --stealth-mode, a bad or a 0.4.7 --mode value exit 1 before any change', () => {
    for (const flags of [
      ['-sm'],
      ['--stealth-mode'],
      ['-m', 'loud'],
      ['-m', 'md', '-m', 'sm'],
      ['-m', 's'],
      ['--mode', 'quiet'],
    ]) {
      seed3();
      const r = rmAll(['-y', ...flags]);
      expect(r.status).toBe(1);
      expect(existsSync(join(tmp, '.claude', 'skills', 'foo', 'SKILL.md'))).toBe(true);
    }
  });
});
