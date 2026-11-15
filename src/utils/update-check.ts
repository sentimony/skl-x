import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { get } from 'node:https';
import { homedir } from 'node:os';
import { dirname, join, sep } from 'node:path';

const PKG = 'skl-x';
const TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 1500;

export function getCachePath(): string {
  return join(homedir(), '.cache', 'skl-x', 'version.json');
}

interface Cache {
  checkedAt: number;
  latest: string;
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i += 1) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da - db;
  }
  return 0;
}

export function readCache(path: string = getCachePath()): Cache | undefined {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Cache;
  } catch {
    return undefined;
  }
}

export function writeCache(cache: Cache, path: string = getCachePath()): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(cache));
  } catch {
    // best-effort: ignore failures (read-only fs, etc.)
  }
}

export type InstallKind = 'global' | 'npx' | 'local';

export function realOrSelf(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

// global: the CLI lives in <npm root -g>/skl-x; the bin is a symlink, so compare real paths.
// globalRoot is lazy: under npx there is no need to spawn npm.
export function detectInstall(
  cliPath: string = process.argv[1] ?? '',
  globalRoot: () => string | undefined = npmGlobalRoot,
): InstallKind {
  const cli = realOrSelf(cliPath);
  if (cli.split(/[\\/]/).includes('_npx')) return 'npx';
  const root = globalRoot();
  if (root && cli.startsWith(join(realOrSelf(root), PKG) + sep)) return 'global';
  return 'local';
}

// Node >= 20 refuses to spawn npm.cmd without a shell on Windows (EINVAL)
export function npmGlobalRoot(): string | undefined {
  const r = spawnSync('npm', ['root', '-g'], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  const out = r.status === 0 ? r.stdout.trim() : '';
  return out || undefined;
}

export function fetchLatest(): Promise<string | undefined> {
  return new Promise((resolve) => {
    const req = get(
      `https://registry.npmjs.org/${PKG}/latest`,
      { timeout: FETCH_TIMEOUT_MS },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          resolve(undefined);
          return;
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          body += chunk;
        });
        res.on('end', () => {
          try {
            const data = JSON.parse(body) as { version?: string };
            resolve(typeof data.version === 'string' ? data.version : undefined);
          } catch {
            resolve(undefined);
          }
        });
      },
    );
    req.on('error', () => resolve(undefined));
    req.on('timeout', () => {
      req.destroy();
      resolve(undefined);
    });
  });
}

export async function maybePrintUpdateNotice(currentVersion: string): Promise<void> {
  // SKLX_NO_UPDATE_CHECK is the pre-0.4.0 name, still honored so existing setups keep working
  if (process.env.SKL_X_NO_UPDATE_CHECK || process.env.SKLX_NO_UPDATE_CHECK) return;

  const now = Date.now();
  const cache = readCache();
  let latest = cache?.latest;

  if (!cache || now - cache.checkedAt > TTL_MS) {
    const fetched = await fetchLatest();
    if (fetched) {
      latest = fetched;
      writeCache({ checkedAt: now, latest });
    }
  }

  if (latest && compareVersions(latest, currentVersion) > 0) {
    const hint = detectInstall() === 'global' ? 'skl update' : `npm i -g ${PKG}`;
    process.stderr.write(`\nUpdate available: ${currentVersion} → ${latest}\nRun: ${hint}\n\n`);
  }
}
