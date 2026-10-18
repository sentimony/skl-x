import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SpawnOutcome } from './add';
import { runUpdate, UPDATE_HELP } from './update';

let out: string[] = [];
let err: string[] = [];

beforeEach(() => {
  out = [];
  err = [];
  vi.spyOn(console, 'log').mockImplementation((s: string) => {
    out.push(s);
  });
  vi.spyOn(console, 'error').mockImplementation((s: string) => {
    err.push(s);
  });
});
afterEach(() => vi.restoreAllMocks());

function deps(over: Partial<Parameters<typeof runUpdate>[1]> = {}) {
  const calls: { command: string; args: string[] }[] = [];
  const saved: string[] = [];
  const spawn = (command: string, args: string[]): SpawnOutcome => {
    calls.push({ command, args });
    return { status: 0 };
  };
  return {
    calls,
    saved,
    deps: {
      version: '0.4.10',
      install: () => 'global' as const,
      latest: async () => '0.4.11',
      spawn,
      saveLatest: (v: string) => saved.push(v),
      cliPath: '/opt/lib/node_modules/skl-x/dist/cli.js',
      ...over,
    },
  };
}

describe('runUpdate', () => {
  it('installs the latest version globally with npm and caches it', async () => {
    const d = deps();
    expect(await runUpdate([], d.deps)).toBe(0);
    expect(d.calls).toEqual([{ command: 'npm', args: ['i', '-g', 'skl-x@0.4.11'] }]);
    expect(out).toEqual([
      'Updating skl-x via `npm i -g skl-x@0.4.11`...',
      '==> Updating skl-x from 0.4.10 to 0.4.11',
      'skl-x 0.4.11 installed successfully.',
    ]);
    expect(d.saved).toEqual(['0.4.11']);
  });

  it('installs nothing when the version is already the latest', async () => {
    const d = deps({ latest: async () => '0.4.10' });
    expect(await runUpdate([], d.deps)).toBe(0);
    expect(d.calls).toEqual([]);
    expect(out).toEqual(['skl-x 0.4.10 is already the latest.']);
    expect(d.saved).toEqual(['0.4.10']);
  });

  it('exits 1 when the registry gives no version', async () => {
    const d = deps({ latest: async () => undefined });
    expect(await runUpdate([], d.deps)).toBe(1);
    expect(d.calls).toEqual([]);
    expect(err.join('\n')).toContain('could not get the latest version from registry.npmjs.org');
  });

  it('exits 1 when npm fails and keeps the cache as it was', async () => {
    const d = deps({ spawn: () => ({ status: 243 }) });
    expect(await runUpdate([], d.deps)).toBe(1);
    expect(err.join('\n')).toContain('npm i -g skl-x@0.4.11 failed (exit code 243)');
    expect(out).not.toContain('skl-x 0.4.11 installed successfully.');
    expect(d.saved).toEqual([]);
  });

  it('under npx installs nothing and names the running version', async () => {
    const d = deps({ install: () => 'npx', version: '0.4.11' });
    expect(await runUpdate([], d.deps)).toBe(0);
    expect(out).toEqual([
      'skl-x 0.4.11 runs through npx, which takes the latest version: npx -y --prefer-online skl-x',
    ]);
    expect(d.calls).toEqual([]);
    expect(d.saved).toEqual([]);
  });

  it('under npx with an older cached copy names both versions', async () => {
    const d = deps({ install: () => 'npx' });
    expect(await runUpdate([], d.deps)).toBe(0);
    expect(out).toEqual([
      'skl-x 0.4.10 runs through npx; the latest is 0.4.11: npx -y --prefer-online skl-x',
    ]);
    expect(d.calls).toEqual([]);
  });

  it('under npx without the registry names the running version only', async () => {
    const d = deps({ install: () => 'npx', latest: async () => undefined });
    expect(await runUpdate([], d.deps)).toBe(0);
    expect(out).toEqual([
      'skl-x 0.4.10 runs through npx, which takes the latest version: npx -y --prefer-online skl-x',
    ]);
  });

  it('from a local copy exits 1, names its folder and asks no registry', async () => {
    const latest = vi.fn(async () => '0.4.11');
    const d = deps({ install: () => 'local', latest, cliPath: '/work/skl-x/dist/cli.js' });
    expect(await runUpdate([], d.deps)).toBe(1);
    expect(err.join('\n')).toContain('skl-x runs from /work/skl-x, not from a global npm install');
    expect(latest).not.toHaveBeenCalled();
    expect(d.calls).toEqual([]);
  });

  it('prints help for -h and refuses arguments', async () => {
    const d = deps();
    expect(await runUpdate(['-h'], d.deps)).toBe(0);
    expect(out).toEqual([UPDATE_HELP]);
    expect(await runUpdate(['0.4.6'], d.deps)).toBe(1);
    expect(err.join('\n')).toContain('unexpected argument 0.4.6');
    expect(d.calls).toEqual([]);
  });
});
