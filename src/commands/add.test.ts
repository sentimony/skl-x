import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setColorEnabled } from '../utils/ansi';
import { FRAME_MS, INTRO_CELLS } from '../utils/progress';
import {
  ADD_HELP,
  defaultSpawn,
  removedInstallMessage,
  requestedSkills,
  runAdd,
  type SpawnOutcome,
  snapshotSkills,
  sourceLabel,
  summaryLine,
} from './add';

let tmp = '';
let proj = '';

function seedSkill(root: string, name: string): void {
  mkdirSync(join(root, 'skills', name), { recursive: true });
  writeFileSync(join(root, 'skills', name, 'SKILL.md'), `---\nname: ${name}\n---\n`);
}

// what `npx skills add … -a codex claude-code` leaves on disk for one skill
function fakeInstall(name: string): void {
  mkdirSync(join(proj, '.agents', 'skills', name), { recursive: true });
  writeFileSync(join(proj, '.agents', 'skills', name, 'SKILL.md'), `---\nname: ${name}\n---\n`);
  mkdirSync(join(proj, '.claude', 'skills'), { recursive: true });
  symlinkSync(`../../.agents/skills/${name}`, join(proj, '.claude', 'skills', name));
  writeFileSync(
    join(proj, 'skills-lock.json'),
    JSON.stringify({ skills: { [name]: { source: 'x' } } }),
  );
}

beforeEach(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), 'skl-install-unit-')));
  proj = join(tmp, 'proj');
  mkdirSync(proj);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const ok = (): SpawnOutcome => ({ status: 0, stdout: '', stderr: '' });

describe('runAdd - lg mode', () => {
  it('passes args to npx skills add unchanged and in order, without capture', async () => {
    const spawn = vi.fn((_c: string, _a: string[], _capture: boolean) => ok());
    const status = await runAdd(
      ['sentimony/skills', '-s', 'cross-review', 'tdd', '-a', 'codex', 'claude-code', '-y'],
      { spawn, cwd: proj },
    );
    expect(status).toBe(0);
    expect(spawn).toHaveBeenCalledWith(
      'npx',
      [
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
      ],
      false,
    );
  });

  it('returns the npx exit code', async () => {
    const spawn = vi.fn(() => ({ status: 3 }));
    expect(await runAdd(['sentimony/skills'], { spawn, cwd: proj })).toBe(3);
  });

  it('returns 1 and reports the error when npx cannot start', async () => {
    const spawn = vi.fn(() => ({ status: null, error: new Error('spawn npx ENOENT') }));
    expect(await runAdd(['sentimony/skills'], { spawn, cwd: proj })).toBe(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('ENOENT'));
  });

  it('prints its own help for -h without spawning npx, even with -ln', async () => {
    const spawn = vi.fn(ok);
    expect(await runAdd(['-h'], { spawn, cwd: proj })).toBe(0);
    expect(await runAdd(['-ln', '--help'], { spawn, cwd: proj })).toBe(0);
    expect(spawn).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith(ADD_HELP);
    expect(ADD_HELP).toContain('USAGE skl-x add <source>');
    expect(ADD_HELP).not.toMatch(/-ln|--link|install/);
  });

  it('rejects a bad --mode value without spawning npx', async () => {
    const spawn = vi.fn(ok);
    expect(await runAdd(['sentimony/skills', '-y', '-m', 'loud'], { spawn, cwd: proj })).toBe(1);
    expect(console.error).toHaveBeenCalledWith(
      'skl add: unknown mode "loud", use sm (small), md (medium) or lg (large)',
    );
    expect(spawn).not.toHaveBeenCalled();
  });

  it('prints a table of the changed skills after the npx output', async () => {
    const spawn = vi.fn((_c: string, _a: string[], _capture: boolean) => {
      fakeInstall('cross-review');
      return ok();
    });
    expect(await runAdd(['sentimony/skills', '-s', 'cross-review'], { spawn, cwd: proj })).toBe(0);
    expect(spawn).toHaveBeenCalledWith(
      'npx',
      ['-y', 'skills', 'add', 'sentimony/skills', '-s', 'cross-review'],
      false,
    );
    expect(vi.mocked(console.log).mock.calls.map((c) => c[0])).toEqual([
      'Installing 1 skill from https://github.com/sentimony/skills to Project scope ██████████ 100%',
      'skill         .agents    .claude    skills-lock.json  cost',
      'cross-review  universal  symlinked  +                 ~4 tok',
      'Installed 1 skill to Project scope · cross-review',
    ]);
  });

  it('prints nothing of its own when npx fails or changes nothing', async () => {
    const failing = vi.fn(() => ({ status: 3 }));
    expect(await runAdd(['sentimony/skills'], { spawn: failing, cwd: proj })).toBe(3);
    expect(await runAdd(['sentimony/skills', '-l'], { spawn: vi.fn(ok), cwd: proj })).toBe(0);
    expect(console.log).not.toHaveBeenCalled();
  });

  it.each([['{bad'], ['{}']])(
    'still runs npx and skips the table when skills-lock.json is %s',
    async (lock) => {
      writeFileSync(join(proj, 'skills-lock.json'), lock);
      const spawn = vi.fn(ok);
      expect(await runAdd(['sentimony/skills', '-y'], { spawn, cwd: proj })).toBe(0);
      expect(spawn).toHaveBeenCalledWith(
        'npx',
        ['-y', 'skills', 'add', 'sentimony/skills', '-y'],
        false,
      );
      expect(console.log).not.toHaveBeenCalled();
    },
  );

  it('returns 0 without a table when npx leaves a broken skills-lock.json', async () => {
    const spawn = vi.fn(() => {
      writeFileSync(join(proj, 'skills-lock.json'), '{bad');
      return ok();
    });
    expect(await runAdd(['sentimony/skills', '-y'], { spawn, cwd: proj })).toBe(0);
    expect(spawn).toHaveBeenCalled();
    expect(console.log).not.toHaveBeenCalled();
  });
});

describe('runAdd - md mode', () => {
  it('hides npx output, strips -m and prints a summary with a table', async () => {
    const spawn = vi.fn((_c: string, _a: string[], _capture: boolean) => {
      fakeInstall('cross-review');
      return { status: 0, stdout: 'NOISE', stderr: '' };
    });
    const status = await runAdd(
      ['sentimony/skills', '-s', 'cross-review', '-a', 'codex', 'claude-code', '-y', '-m', 'md'],
      { spawn, cwd: proj },
    );
    expect(status).toBe(0);
    expect(spawn).toHaveBeenCalledWith(
      'npx',
      [
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
      ],
      true,
      expect.any(Function),
    );
    expect(vi.mocked(console.log).mock.calls.map((c) => c[0])).toEqual([
      'Installing 1 skill from https://github.com/sentimony/skills to Project scope ██████████ 100%',
      'skill         .agents    .claude    skills-lock.json  cost',
      'cross-review  universal  symlinked  +                 ~4 tok',
      'Installed 1 skill to Project scope · cross-review',
    ]);
  });

  it('needs -y and does not spawn npx without it', async () => {
    const spawn = vi.fn(ok);
    expect(await runAdd(['sentimony/skills', '--mode', 'medium'], { spawn, cwd: proj })).toBe(1);
    expect(console.error).toHaveBeenCalledWith(
      'skl add: --mode md needs -y/--yes (npx skills add asks questions otherwise)',
    );
    expect(spawn).not.toHaveBeenCalled();
  });

  it('prints the captured output and keeps the exit code when npx fails', async () => {
    const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const spawn = vi.fn(() => ({ status: 2, stdout: 'out', stderr: 'err' }));
    expect(await runAdd(['sentimony/skills', '-y', '-m', 'md'], { spawn, cwd: proj })).toBe(2);
    expect(out).toHaveBeenCalledWith('out');
    expect(err).toHaveBeenCalledWith('err');
    expect(console.log).toHaveBeenCalledWith(
      'Installing from https://github.com/sentimony/skills to Project scope',
    );
  });

  it('reports 0 skills without a table when nothing changed', async () => {
    fakeInstall('tdd');
    const spawn = vi.fn(ok);
    expect(await runAdd(['sentimony/skills', '-y', '-m', 'md'], { spawn, cwd: proj })).toBe(0);
    expect(vi.mocked(console.log).mock.calls.map((c) => c[0])).toEqual([
      'Installing 0 skills from https://github.com/sentimony/skills to Project scope ██████████ 100%',
      'Installed 0 skills to Project scope',
    ]);
  });

  it('counts a reinstalled skill and skips an untouched one', async () => {
    fakeInstall('tdd');
    // pin old mtimes so the reinstall is detected even if ext4 reuses the inode within one clock tick
    for (const p of [
      join(proj, '.agents', 'skills', 'tdd'),
      join(proj, '.agents', 'skills', 'tdd', 'SKILL.md'),
    ])
      utimesSync(p, new Date(0), new Date(0));
    seedSkill(join(proj, '.agents'), 'untouched');
    const spawn = vi.fn(() => {
      rmSync(join(proj, '.agents', 'skills', 'tdd'), { recursive: true });
      rmSync(join(proj, '.claude', 'skills', 'tdd'));
      fakeInstall('tdd');
      return ok();
    });
    expect(await runAdd(['sentimony/skills', '-y', '-m', 'md'], { spawn, cwd: proj })).toBe(0);
    expect(console.log).toHaveBeenCalledWith(
      'Installing 1 skill from https://github.com/sentimony/skills to Project scope ██████████ 100%',
    );
    expect(console.log).toHaveBeenCalledWith('Installed 1 skill to Project scope · tdd');
    expect(console.log).toHaveBeenCalledWith(
      'tdd    universal  symlinked  +                 ~1 tok',
    );
  });

  it('snapshots the global dirs under deps.home with -g', async () => {
    const home = join(tmp, 'home');
    const spawn = vi.fn(() => {
      mkdirSync(join(home, '.agents', 'skills', 'g1'), { recursive: true });
      writeFileSync(join(home, '.agents', 'skills', 'g1', 'SKILL.md'), '---\nname: g1\n---\n');
      writeFileSync(
        join(home, '.agents', '.skill-lock.json'),
        JSON.stringify({ skills: { g1: {} } }),
      );
      return ok();
    });
    expect(
      await runAdd(['sentimony/skills', '-g', '-y', '-m', 'md'], { spawn, cwd: proj, home }),
    ).toBe(0);
    const lines = vi.mocked(console.log).mock.calls.map((c) => String(c[0]));
    expect(lines).toContain(
      'Installing 1 skill from https://github.com/sentimony/skills to Global scope ██████████ 100%',
    );
    expect(lines.at(-1)).toBe('Installed 1 skill to Global scope · g1');
    expect(lines.some((l) => l.startsWith('skill') && l.includes('.agents/.skill-lock.json'))).toBe(
      true,
    );
    expect(lines.some((l) => /^g1 +universal +- +\+ +~1 tok$/.test(l))).toBe(true);
  });

  it('counts a skill whose only change is its lock entry', async () => {
    fakeInstall('tdd');
    const spawn = vi.fn(() => {
      writeFileSync(
        join(proj, 'skills-lock.json'),
        JSON.stringify({ skills: { tdd: { source: 'y' } } }),
      );
      return ok();
    });
    expect(await runAdd(['sentimony/skills', '-y', '-m', 'md'], { spawn, cwd: proj })).toBe(0);
    expect(console.log).toHaveBeenCalledWith('Installed 1 skill to Project scope · tdd');
  });

  it('drops "from <source>" when the first argument is a flag', async () => {
    const spawn = vi.fn(ok);
    expect(await runAdd(['-y', 'sentimony/skills', '-m', 'md'], { spawn, cwd: proj })).toBe(0);
    expect(vi.mocked(console.log).mock.calls.map((c) => c[0])).toEqual([
      'Installing 0 skills to Project scope ██████████ 100%',
      'Installed 0 skills to Project scope',
    ]);
  });
  it('awaits an async spawner', async () => {
    const spawn = vi.fn(async () => {
      fakeInstall('tdd');
      return ok();
    });
    expect(
      await runAdd(['sentimony/skills', '-s', 'tdd', '-y', '-m', 'md'], { spawn, cwd: proj }),
    ).toBe(0);
    expect(console.log).toHaveBeenCalledWith('Installed 1 skill to Project scope · tdd');
  });

  it('shows the bar once online, fills the intro, then follows npx and the disk', async () => {
    vi.useFakeTimers();
    const tty = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    const frames: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((s) => {
      frames.push(String(s));
      return true;
    });
    const last = () => frames.at(-1)?.replace('\r\x1b[2K', '');
    const label = 'Installing 2 skills from https://github.com/sentimony/skills to Project scope';
    try {
      let finish: (r: SpawnOutcome) => void = () => {};
      let output: () => void = () => {};
      const spawn = vi.fn(
        (_c: string, _a: string[], _capture: boolean, onOutput?: () => void) =>
          new Promise<SpawnOutcome>((done) => {
            finish = done;
            output = onOutput ?? (() => {});
          }),
      );
      let online: (ok: boolean) => void = () => {};
      const run = runAdd(['sentimony/skills', '-s', 'a', 'b', '-y', '-m', 'md'], {
        spawn,
        cwd: proj,
        online: () => new Promise((done) => (online = done)),
      });
      expect(frames).toEqual([]);
      online(true);
      await vi.advanceTimersByTimeAsync(0);
      expect(last()).toBe(`${label} ░░░░░░░░░░ 0%`);
      await vi.advanceTimersByTimeAsync(INTRO_CELLS * FRAME_MS);
      expect(last()).toBe(`${label} ███████░░░ 70%`);
      output();
      await vi.advanceTimersByTimeAsync(100);
      expect(last()).toBe(`${label} ███████░░░ 70%`);
      await vi.advanceTimersByTimeAsync(FRAME_MS - 100);
      expect(last()).toBe(`${label} ████████░░ 80%`);
      fakeInstall('a');
      fakeInstall('b');
      await vi.advanceTimersByTimeAsync(FRAME_MS);
      expect(last()).toBe(`${label} █████████░ 90%`);
      finish(ok());
      // 90% stays for its whole frame before the final line
      await vi.advanceTimersByTimeAsync(FRAME_MS);
      expect(await run).toBe(0);
      expect(console.log).toHaveBeenCalledWith(`${label} ██████████ 100%`);
      const count = frames.length;
      await vi.advanceTimersByTimeAsync(500);
      expect(frames.length).toBe(count);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      if (tty) Object.defineProperty(process.stdout, 'isTTY', tty);
      else delete (process.stdout as { isTTY?: boolean }).isTTY;
      vi.useRealTimers();
    }
  });
});

describe('summaryLine', () => {
  afterEach(() => setColorEnabled(false));

  it('names the scope, grays the words and paints the skill names cyan', () => {
    expect(summaryLine('Installed', [], 'Global scope')).toBe('Installed 0 skills to Global scope');
    setColorEnabled(true);
    expect(summaryLine('Installed', ['tdd', 'vitest'], 'Project scope')).toBe(
      '\x1b[90mInstalled 2 skills to Project scope\x1b[0m \x1b[90m·\x1b[0m \x1b[36mtdd vitest\x1b[0m',
    );
  });
});

describe('sourceLabel', () => {
  it('expands the owner/repo shorthand to a GitHub URL', () => {
    expect(sourceLabel('sentimony/skills')).toBe('https://github.com/sentimony/skills');
  });

  it('keeps URLs, paths and flags as given', () => {
    expect(sourceLabel('https://github.com/sentimony/skills')).toBe(
      'https://github.com/sentimony/skills',
    );
    expect(sourceLabel('../skills')).toBe('../skills');
    expect(sourceLabel('./skills')).toBe('./skills');
    expect(sourceLabel('~/skills')).toBe('~/skills');
    expect(sourceLabel('sentimony/skills/tree/main/skills/tdd')).toBe(
      'sentimony/skills/tree/main/skills/tdd',
    );
    expect(sourceLabel('-y')).toBe('');
    expect(sourceLabel(undefined)).toBe('');
  });
});

describe('requestedSkills', () => {
  it('collects names after -s/--skill up to the next flag', () => {
    expect(
      requestedSkills(['x/y', '-s', 'tdd', 'cross-review', '-a', 'codex', '--skill', 'tdd']),
    ).toEqual(['tdd', 'cross-review']);
  });

  it('has no total without -s or with *', () => {
    expect(requestedSkills(['x/y', '-y'])).toBeNull();
    expect(requestedSkills(['x/y', '-s', '*'])).toBeNull();
  });
});

describe('runAdd - removed -ln', () => {
  it.each([
    [['-ln', '../clone', '-y']],
    [['../clone', '--link']],
    [['../clone', '-ln', '-y', '-m', 'md']],
  ])('%j exits 1 with use skl sln and does not spawn npx', async (argv) => {
    const spawn = vi.fn(ok);
    expect(await runAdd(argv, { spawn, cwd: proj })).toBe(1);
    expect(console.error).toHaveBeenCalledWith(
      'skl add: -ln/--link was removed in 0.4.6, use skl sln',
    );
    expect(spawn).not.toHaveBeenCalled();
  });
});

describe('runAdd - sm mode', () => {
  it('prints one summary line and hides the npx output', async () => {
    const spawn = vi.fn((_c: string, _a: string[], _capture: boolean) => {
      fakeInstall('cross-review');
      return { status: 0, stdout: 'NOISE', stderr: '' };
    });
    expect(
      await runAdd(['sentimony/skills', '-s', 'cross-review', '-y', '-m', 'sm'], {
        spawn,
        cwd: proj,
      }),
    ).toBe(0);
    expect(spawn).toHaveBeenCalledWith(
      'npx',
      ['-y', 'skills', 'add', 'sentimony/skills', '-s', 'cross-review', '-y'],
      true,
    );
    expect(vi.mocked(console.log).mock.calls.map((c) => c[0])).toEqual([
      'Installed 1 skill to Project scope · cross-review',
    ]);
  });

  it('prints the count alone when nothing changed', async () => {
    const spawn = vi.fn(ok);
    expect(await runAdd(['-y', 'sentimony/skills', '--mode', 'small'], { spawn, cwd: proj })).toBe(
      0,
    );
    expect(vi.mocked(console.log).mock.calls.map((c) => c[0])).toEqual([
      'Installed 0 skills to Project scope',
    ]);
  });

  it('needs -y and does not spawn npx without it', async () => {
    const spawn = vi.fn(ok);
    expect(await runAdd(['sentimony/skills', '-m', 'sm'], { spawn, cwd: proj })).toBe(1);
    expect(console.error).toHaveBeenCalledWith(
      'skl add: --mode sm needs -y/--yes (npx skills add asks questions otherwise)',
    );
    expect(spawn).not.toHaveBeenCalled();
  });

  it('prints the captured output and keeps the exit code when npx fails', async () => {
    const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const spawn = vi.fn(() => ({ status: 2, stdout: 'out', stderr: 'err' }));
    expect(await runAdd(['sentimony/skills', '-y', '-m', 'sm'], { spawn, cwd: proj })).toBe(2);
    expect(out).toHaveBeenCalledWith('out');
    expect(err).toHaveBeenCalledWith('err');
    expect(console.log).not.toHaveBeenCalled();
  });
});

describe('removedInstallMessage', () => {
  it('points install and i to skl add, and their -ln/--link to skl sln', () => {
    expect(removedInstallMessage('i', ['sentimony/skills', '-y'])).toBe(
      'skl i was removed in 0.4.6, use skl add',
    );
    expect(removedInstallMessage('install', [])).toBe(
      'skl install was removed in 0.4.6, use skl add',
    );
    expect(removedInstallMessage('i', ['-ln', '../skills'])).toBe(
      'skl i -ln was removed in 0.4.6, use skl sln',
    );
    expect(removedInstallMessage('install', ['../skills', '--link'])).toBe(
      'skl install --link was removed in 0.4.6, use skl sln',
    );
  });
});

describe('snapshotSkills', () => {
  it('keys every name in both roots and the lock', () => {
    fakeInstall('a');
    seedSkill(join(proj, '.claude'), 'b');
    const snap = snapshotSkills(
      { agents: join(proj, '.agents', 'skills'), claude: join(proj, '.claude', 'skills') },
      join(proj, 'skills-lock.json'),
    );
    expect([...snap.keys()].sort()).toEqual(['a', 'b']);
  });
});

describe('defaultSpawn - capture', () => {
  it('reports a missing command as an error with no status', async () => {
    const r = await defaultSpawn('skl-x-no-such-command', [], true);
    expect(r.status).toBeNull();
    expect((r.error as NodeJS.ErrnoException | undefined)?.code).toBe('ENOENT');
  });

  it('keeps a multibyte character split across chunks intact', async () => {
    // "█" is e2 96 88; the last byte arrives in a later chunk
    const script =
      'process.stdout.write(Buffer.from([0xe2, 0x96]));' +
      'setTimeout(() => process.stdout.write(Buffer.from([0x88, 0x0a])), 50);';
    const r = await defaultSpawn(process.execPath, ['-e', script], true);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('█\n');
  });
});
