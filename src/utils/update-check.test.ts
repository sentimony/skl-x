import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  compareVersions,
  detectInstall,
  getCachePath,
  readCache,
  writeCache,
} from './update-check';

describe('compareVersions', () => {
  it('detects patch bump', () => expect(compareVersions('0.1.5', '0.1.4')).toBeGreaterThan(0));
  it('detects minor bump', () => expect(compareVersions('0.2.0', '0.1.99')).toBeGreaterThan(0));
  it('detects major bump', () => expect(compareVersions('1.0.0', '0.99.99')).toBeGreaterThan(0));
  it('lexically tricky double-digit patch', () =>
    expect(compareVersions('0.1.10', '0.1.9')).toBeGreaterThan(0));
  it('returns 0 for equal versions', () => expect(compareVersions('1.2.3', '1.2.3')).toBe(0));
  it('returns negative when a < b', () =>
    expect(compareVersions('0.1.4', '0.1.5')).toBeLessThan(0));
  it('treats missing parts as 0', () => expect(compareVersions('1.0', '1.0.0')).toBe(0));
});

describe('getCachePath', () => {
  it('stores the cache under ~/.cache/skl-x', () => {
    expect(getCachePath()).toBe(join(homedir(), '.cache', 'skl-x', 'version.json'));
  });
});

describe('cache read/write', () => {
  let TMP = '';
  beforeEach(() => {
    TMP = join(tmpdir(), `skl-x-uc-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(TMP, { recursive: true });
  });
  afterEach(() => rmSync(TMP, { recursive: true, force: true }));

  it('returns undefined when cache file missing', () => {
    expect(readCache(join(TMP, 'missing.json'))).toBeUndefined();
  });
  it('round-trips a cache entry', () => {
    const path = join(TMP, 'cache.json');
    writeCache({ checkedAt: 1700000000000, latest: '0.1.5' }, path);
    expect(readCache(path)).toEqual({ checkedAt: 1700000000000, latest: '0.1.5' });
  });
  it('returns undefined on malformed JSON', () => {
    const path = join(TMP, 'bad.json');
    writeCache({ checkedAt: 1, latest: 'x' }, path);
    require('node:fs').writeFileSync(path, '{not json');
    expect(readCache(path)).toBeUndefined();
  });
});

describe('detectInstall', () => {
  let TMP = '';
  beforeEach(() => {
    TMP = realpathSync(mkdtempSync(join(tmpdir(), 'skl-x-di-')));
  });
  afterEach(() => rmSync(TMP, { recursive: true, force: true }));

  function seedCli(dir: string): string {
    mkdirSync(join(dir, 'dist'), { recursive: true });
    writeFileSync(join(dir, 'dist', 'cli.js'), '');
    return join(dir, 'dist', 'cli.js');
  }

  it('is global for <npm root -g>/skl-x, also through the bin symlink', () => {
    const root = join(TMP, 'lib', 'node_modules');
    const cli = seedCli(join(root, 'skl-x'));
    mkdirSync(join(TMP, 'bin'));
    symlinkSync(cli, join(TMP, 'bin', 'skl'));
    expect(detectInstall(cli, () => root)).toBe('global');
    expect(detectInstall(join(TMP, 'bin', 'skl'), () => root)).toBe('global');
  });

  it('is npx under a _npx folder and does not ask npm for the global root', () => {
    const cli = seedCli(join(TMP, '_npx', 'abc', 'node_modules', 'skl-x'));
    const globalRoot = vi.fn(() => join(TMP, 'lib', 'node_modules'));
    expect(detectInstall(cli, globalRoot)).toBe('npx');
    expect(globalRoot).not.toHaveBeenCalled();
  });

  it('is local for a project dependency, a clone, or an unknown global root', () => {
    const root = join(TMP, 'lib', 'node_modules');
    seedCli(join(root, 'skl-x'));
    const dep = seedCli(join(TMP, 'project', 'node_modules', 'skl-x'));
    const clone = seedCli(join(TMP, 'skl-x'));
    expect(detectInstall(dep, () => root)).toBe('local');
    expect(detectInstall(clone, () => root)).toBe('local');
    expect(detectInstall(clone, () => undefined)).toBe('local');
  });

  it('is local for a sibling package whose name starts with skl-x', () => {
    const root = join(TMP, 'lib', 'node_modules');
    expect(detectInstall(seedCli(join(root, 'skl-x-fork')), () => root)).toBe('local');
  });
});
