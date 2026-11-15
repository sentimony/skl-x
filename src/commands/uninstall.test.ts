import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SpawnOutcome } from './add';
import { runUninstall, UNINSTALL_HELP } from './uninstall';

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

function deps(over: Partial<Parameters<typeof runUninstall>[1]> = {}) {
  const calls: { command: string; args: string[] }[] = [];
  const asked: string[] = [];
  let cacheRemoved = 0;
  const spawn = (command: string, args: string[]): SpawnOutcome => {
    calls.push({ command, args });
    return { status: 0 };
  };
  return {
    calls,
    asked,
    cacheRemoved: () => cacheRemoved,
    deps: {
      version: '0.4.12',
      install: () => 'global' as const,
      spawn,
      confirm: async (q: string) => {
        asked.push(q);
        return true;
      },
      removeCache: () => {
        cacheRemoved += 1;
      },
      cliPath: '/opt/lib/node_modules/skl-x/dist/cli.js',
      ...over,
    },
  };
}

const COMPLETION_NOTE =
  'A completion script added with skl completion stays in your shell rc file: remove it by hand.';

describe('runUninstall', () => {
  it('asks, removes the global install with npm and drops the cache', async () => {
    const d = deps();
    expect(await runUninstall([], d.deps)).toBe(0);
    expect(d.asked).toEqual(['Remove skl-x 0.4.12 from the global npm install?']);
    expect(d.calls).toEqual([{ command: 'npm', args: ['uninstall', '-g', 'skl-x'] }]);
    expect(out).toEqual(['==> Removing skl-x 0.4.12', 'skl-x 0.4.12 removed.', COMPLETION_NOTE]);
    expect(d.cacheRemoved()).toBe(1);
  });

  it.each(['-y', '--yes'])('%s removes without asking', async (flag) => {
    const d = deps();
    expect(await runUninstall([flag], d.deps)).toBe(0);
    expect(d.asked).toEqual([]);
    expect(d.calls).toHaveLength(1);
  });

  it('removes nothing when the answer is no', async () => {
    const d = deps({ confirm: async () => false });
    expect(await runUninstall([], d.deps)).toBe(1);
    expect(out).toEqual(['Aborted']);
    expect(d.calls).toEqual([]);
    expect(d.cacheRemoved()).toBe(0);
  });

  it('exits 1 when npm fails and keeps the cache', async () => {
    const d = deps({ spawn: () => ({ status: 243 }) });
    expect(await runUninstall(['-y'], d.deps)).toBe(1);
    expect(err.join('\n')).toContain('npm uninstall -g skl-x failed (exit code 243)');
    expect(out).not.toContain('skl-x 0.4.12 removed.');
    expect(d.cacheRemoved()).toBe(0);
  });

  it('under npx removes nothing and asks nothing', async () => {
    const d = deps({ install: () => 'npx' });
    expect(await runUninstall([], d.deps)).toBe(0);
    expect(out).toEqual(['skl-x 0.4.12 runs through npx: there is no global install to remove']);
    expect(d.asked).toEqual([]);
    expect(d.calls).toEqual([]);
  });

  it('from a local copy exits 1 and names its folder', async () => {
    const d = deps({ install: () => 'local', cliPath: '/work/skl-x/dist/cli.js' });
    expect(await runUninstall(['-y'], d.deps)).toBe(1);
    expect(err.join('\n')).toContain('skl-x runs from /work/skl-x, not from a global npm install');
    expect(d.calls).toEqual([]);
    expect(d.cacheRemoved()).toBe(0);
  });

  it('prints help for -h and refuses other arguments', async () => {
    const d = deps();
    expect(await runUninstall(['-h'], d.deps)).toBe(0);
    expect(out).toEqual([UNINSTALL_HELP]);
    expect(await runUninstall(['tdd'], d.deps)).toBe(1);
    expect(err.join('\n')).toContain('unexpected argument tdd');
    expect(d.calls).toEqual([]);
  });
});
