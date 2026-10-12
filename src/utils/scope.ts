import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { getLockPath } from '../lock/file';
import { bold } from './ansi';

export function scopeLabel(isGlobal: boolean): string {
  return isGlobal ? 'Global scope' : 'Project scope';
}

export function scopeHeader(isGlobal: boolean): string {
  return bold(scopeLabel(isGlobal));
}

// Nearest ancestor of cwd (inclusive) with .git (dir or file), else cwd itself
export function findProjectRoot(cwd: string): string {
  return findGitRoot(cwd) ?? cwd;
}

export function scopeLockPath(global: boolean, cwd: string): string {
  return global ? getLockPath(true) : join(findProjectRoot(cwd), 'skills-lock.json');
}

export function isPathInProject(path: string, projectRoot: string): boolean {
  const p = norm(path);
  const r = norm(projectRoot);
  return p === r || p.startsWith(`${r}/`);
}

export function encodeClaudeProjectDir(absPath: string): string {
  return absPath.replaceAll('/', '-');
}

function findGitRoot(start: string): string | undefined {
  let dir = start;
  while (true) {
    if (existsSync(join(dir, '.git'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

function norm(p: string): string {
  return p.toLowerCase().replace(/\/+$/, '');
}
