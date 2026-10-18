import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { run } from './helpers';

// dist/cli.js of the clone is a local copy: update exits before any network call.
describe('skl update', () => {
  it.each(['update', 'up'])('%s from a local copy exits 1 and installs nothing', (cmd) => {
    const r = run([cmd]);
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain(`skl-x runs from ${process.cwd()}, not from a global npm install`);
  });

  it('up -h prints the usage', () => {
    const r = run(['up', '-h']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('USAGE skl-x update');
  });

  it('is listed in the root help', () => {
    expect(run(['-h']).stdout).toContain('update, up');
  });
});

describe('skl update and the update notice', () => {
  let home = '';
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'skl-x-up-'));
    mkdirSync(join(home, '.cache', 'skl-x'), { recursive: true });
    writeFileSync(
      join(home, '.cache', 'skl-x', 'version.json'),
      JSON.stringify({ checkedAt: Date.now(), latest: '99.0.0' }),
    );
  });
  afterEach(() => rmSync(home, { recursive: true, force: true }));

  it('prints no notice', () => {
    const env: NodeJS.ProcessEnv = { ...process.env, HOME: home };
    delete env.SKL_X_NO_UPDATE_CHECK;
    delete env.SKLX_NO_UPDATE_CHECK;
    const r = spawnSync(process.execPath, [join(process.cwd(), 'dist', 'cli.js'), 'update'], {
      encoding: 'utf8',
      env,
    });
    expect(r.stderr).not.toContain('Update available');
  });
});
