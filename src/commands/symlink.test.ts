import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseSymlinkArgs, planSymlinks, runSln, runSymlink } from './symlink';

describe('parseSymlinkArgs', () => {
  it('collects several -s and -a values', () => {
    expect(
      parseSymlinkArgs([
        '../skills',
        '-s',
        'tdd',
        'cross-review',
        '-a',
        'codex',
        'claude-code',
        '-y',
      ]),
    ).toEqual({
      kind: 'ok',
      args: {
        source: '../skills',
        skills: ['tdd', 'cross-review'],
        rejects: [],
        agents: ['codex', 'claude-code'],
        yes: true,
      },
    });
  });

  it('defaults agents to both and yes to false', () => {
    expect(parseSymlinkArgs(['../skills', '-s', 'tdd'])).toEqual({
      kind: 'ok',
      args: {
        source: '../skills',
        skills: ['tdd'],
        rejects: [],
        agents: ['codex', 'claude-code'],
        yes: false,
      },
    });
  });

  it('keeps space-prefixed names as -s values', () => {
    const r = parseSymlinkArgs(['../skills', '-s', 'tdd', ' scope-check']);
    expect(r.kind === 'ok' && r.args.skills).toEqual(['tdd', ' scope-check']);
  });

  it('accepts long forms and dedupes agents', () => {
    expect(
      parseSymlinkArgs([
        '../skills',
        '--skill',
        'tdd',
        '--agent',
        'claude-code',
        'claude-code',
        '--yes',
      ]),
    ).toEqual({
      kind: 'ok',
      args: {
        source: '../skills',
        skills: ['tdd'],
        rejects: [],
        agents: ['claude-code'],
        yes: true,
      },
    });
  });

  it('without -s selects every skill (skills: null) and collects -x values', () => {
    expect(parseSymlinkArgs(['../skills', '-x', 'a', 'b', ' c', '--reject', 'd', '-y'])).toEqual({
      kind: 'ok',
      args: {
        source: '../skills',
        skills: null,
        rejects: ['a', 'b', 'd'],
        agents: ['codex', 'claude-code'],
        yes: true,
      },
    });
  });

  it('prefixes argument errors with skl sln', () => {
    const r = parseSymlinkArgs(['-s', 'tdd']);
    expect(r).toEqual({ kind: 'error', message: 'skl sln: missing <path>' });
  });

  it.each([
    [['-s', 'tdd'], 'missing <path>'],
    [['../skills', '-s'], '-s needs at least one value'],
    [['../skills', '-s', 'tdd', '-a', 'cursor'], 'Unknown agent: "cursor"'],
    [['../skills', '-s', 'tdd', '--force'], 'Unknown option: --force'],
    [['../skills', '-s', 'tdd', '-g'], '-g/--global is not supported yet'],
    [['../a', '../b', '-s', 'tdd'], 'takes one source'],
    [['../skills', '-s', '..'], 'invalid skill name ".."'],
    [['../skills', '-s', '.'], 'invalid skill name "."'],
    [['../skills', '-s', 'tdd', 'a/b'], 'invalid skill name "a/b"'],
    [['../skills', '-x'], '-x needs at least one value'],
    [['../skills', '-s', 'tdd', '-x', 'vitest'], '-x/--reject cannot be combined with -s/--skill'],
    [['../skills', '-x', '..'], 'invalid skill name ".."'],
    [['../skills', '-l'], 'Unknown option: -l'],
  ])('rejects %j', (argv, message) => {
    const r = parseSymlinkArgs(argv);
    expect(r.kind).toBe('error');
    if (r.kind === 'error') expect(r.message).toContain(message);
  });
});

const BOTH = ['.agents/skills', '.claude/skills'];

let tmp = '';
let clone = '';
let proj = '';

function seedSkill(root: string, name: string): void {
  mkdirSync(join(root, 'skills', name), { recursive: true });
  writeFileSync(
    join(root, 'skills', name, 'SKILL.md'),
    `---\nname: ${name}\ndescription: test skill\n---\n`,
  );
}

describe('planSymlinks / runSymlink', () => {
  beforeEach(() => {
    // realpath: on macOS tmpdir() is under the /var -> /private/var symlink, and planSymlinks
    // computes targets from physical dirs
    tmp = realpathSync(mkdtempSync(join(tmpdir(), 'skl-symlink-unit-')));
    clone = join(tmp, 'clone');
    proj = join(tmp, 'proj');
    mkdirSync(proj);
    seedSkill(clone, 'tdd');
    seedSkill(clone, 'cross-review');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('planSymlinks classifies new, same and replace', () => {
    mkdirSync(join(proj, '.agents/skills/tdd'), { recursive: true });
    mkdirSync(join(proj, '.claude/skills'), { recursive: true });
    symlinkSync('../../../clone/skills/tdd', join(proj, '.claude/skills/tdd'));
    const steps = planSymlinks({
      cwd: proj,
      skillsAbs: join(clone, 'skills'),
      names: ['tdd', 'cross-review'],
      dirs: BOTH,
    });
    expect(steps.map((s) => [s.dir, s.name, s.action, s.existing])).toEqual([
      ['.agents/skills', 'tdd', 'replace', 'folder'],
      ['.claude/skills', 'tdd', 'same', 'symlink'],
      ['.agents/skills', 'cross-review', 'new', 'none'],
      ['.claude/skills', 'cross-review', 'new', 'none'],
    ]);
    expect(steps[0]?.target).toBe('../../../clone/skills/tdd');
  });

  it('planSymlinks treats a symlink to another target, even a dangling one, as replace', () => {
    mkdirSync(join(proj, '.agents/skills'), { recursive: true });
    symlinkSync('../../missing/tdd', join(proj, '.agents/skills/tdd'));
    const [step] = planSymlinks({
      cwd: proj,
      skillsAbs: join(clone, 'skills'),
      names: ['tdd'],
      dirs: ['.agents/skills'],
    });
    expect(step).toMatchObject({
      action: 'replace',
      existing: 'symlink',
      existingTarget: '../../missing/tdd',
    });
  });

  it('links into both dirs, replaces a copy with -y and skips space-prefixed names', async () => {
    mkdirSync(join(proj, '.agents/skills/tdd'), { recursive: true });
    writeFileSync(join(proj, '.agents/skills/tdd/SKILL.md'), 'copy');
    const confirm = vi.fn(async (_q: string) => true);
    const status = await runSymlink(['../clone', '-s', 'tdd', ' scope-check', '-y'], {
      cwd: proj,
      confirm,
    });
    expect(status).toBe(0);
    expect(confirm).not.toHaveBeenCalled();
    for (const dir of BOTH) {
      expect(lstatSync(join(proj, dir, 'tdd')).isSymbolicLink()).toBe(true);
      expect(readlinkSync(join(proj, dir, 'tdd'))).toBe('../../../clone/skills/tdd');
      expect(existsSync(join(proj, dir, ' scope-check'))).toBe(false);
    }
    expect(console.log).toHaveBeenCalledWith(
      'Symlinking 1 skill from ../clone to Project scope ██████████ 100%',
    );
    expect(console.log).toHaveBeenCalledWith('Symlinked 1 skill to Project scope · tdd');
  });

  it('maps -a claude-code to .claude/skills only', async () => {
    const status = await runSymlink(
      ['../clone', '-s', 'tdd', 'cross-review', '-a', 'claude-code'],
      {
        cwd: proj,
      },
    );
    expect(status).toBe(0);
    expect(existsSync(join(proj, '.agents'))).toBe(false);
    expect(readlinkSync(join(proj, '.claude/skills/cross-review'))).toBe(
      '../../../clone/skills/cross-review',
    );
    expect(console.log).toHaveBeenCalledWith(
      'Symlinking 2 skills from ../clone to Project scope ██████████ 100%',
    );
    expect(console.log).toHaveBeenCalledWith(
      'Symlinked 2 skills to Project scope · tdd cross-review',
    );
  });

  it('is idempotent: a second run without -y asks nothing', async () => {
    expect(await runSymlink(['../clone', '-s', 'tdd', '-y'], { cwd: proj })).toBe(0);
    const confirm = vi.fn(async (_q: string) => false);
    expect(await runSymlink(['../clone', '-s', 'tdd'], { cwd: proj, confirm })).toBe(0);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('asks before replacing a copy and changes nothing on no', async () => {
    mkdirSync(join(proj, '.claude/skills/tdd'), { recursive: true });
    const confirm = vi.fn(async (_q: string) => false);
    const status = await runSymlink(['../clone', '-s', 'tdd', 'cross-review'], {
      cwd: proj,
      confirm,
    });
    expect(status).toBe(1);
    expect(confirm).toHaveBeenCalledWith('Replace 1 existing skill?');
    expect(console.log).toHaveBeenCalledWith('.claude/skills/tdd - folder');
    expect(lstatSync(join(proj, '.claude/skills/tdd')).isDirectory()).toBe(true);
    expect(existsSync(join(proj, '.agents/skills/cross-review'))).toBe(false);
  });

  it('replaces a copy after yes', async () => {
    mkdirSync(join(proj, '.claude/skills/tdd'), { recursive: true });
    const confirm = vi.fn(async (_q: string) => true);
    expect(await runSymlink(['../clone', '-s', 'tdd'], { cwd: proj, confirm })).toBe(0);
    expect(lstatSync(join(proj, '.claude/skills/tdd')).isSymbolicLink()).toBe(true);
    expect(confirm).toHaveBeenCalledOnce();
    // the progress line comes after the listing of replaced skills, never inside it
    const lines = vi.mocked(console.log).mock.calls.map((c) => String(c[0]));
    const listed = lines.findIndex((l) => l.startsWith('.claude/skills/tdd - '));
    const done = lines.findIndex((l) =>
      l.startsWith('Symlinking 1 skill from ../clone to Project scope ██████████ 100%'),
    );
    expect(listed).toBeGreaterThanOrEqual(0);
    expect(done).toBeGreaterThan(listed);
  });

  it('fails before any change when a skill is missing in the clone', async () => {
    expect(await runSymlink(['../clone', '-s', 'tdd', 'nope', '-y'], { cwd: proj })).toBe(1);
    expect(existsSync(join(proj, '.agents'))).toBe(false);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('nope'));
  });

  it('ends the progress line and rethrows when a link cannot be made', async () => {
    // a read-only skills folder: planning passes, the symlink call fails
    mkdirSync(join(proj, '.claude/skills'), { recursive: true });
    chmodSync(join(proj, '.claude/skills'), 0o500);
    try {
      await expect(
        runSymlink(['../clone', '-s', 'tdd', '-a', 'claude-code', '-y'], { cwd: proj }),
      ).rejects.toThrow(/EACCES/);
    } finally {
      chmodSync(join(proj, '.claude/skills'), 0o700);
    }
    expect(console.log).toHaveBeenCalledWith('Symlinking 1 skill from ../clone to Project scope');
  });

  it('rejects ".." with -y and keeps .agents intact', async () => {
    writeFileSync(join(clone, 'SKILL.md'), '---\nname: root\n---\n');
    mkdirSync(join(proj, '.agents/skills/keep'), { recursive: true });
    expect(await runSymlink(['../clone', '-s', '..', '-y'], { cwd: proj })).toBe(1);
    expect(existsSync(join(proj, '.agents/skills/keep'))).toBe(true);
  });

  it('refuses to replace a folder that is the source itself', async () => {
    seedSkill(join(proj, '.agents'), 'tdd');
    expect(await runSymlink(['.agents', '-s', 'tdd', '-y'], { cwd: proj })).toBe(1);
    expect(existsSync(join(proj, '.agents/skills/tdd/SKILL.md'))).toBe(true);
    expect(lstatSync(join(proj, '.agents/skills/tdd')).isDirectory()).toBe(true);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('is the source itself'));
  });

  it('refuses to replace a symlink the source is reached through', async () => {
    mkdirSync(join(proj, '.agents/skills'), { recursive: true });
    symlinkSync('../../../clone/skills/tdd', join(proj, '.agents/skills/tdd'));
    expect(await runSymlink(['.agents', '-s', 'tdd', '-y'], { cwd: proj })).toBe(1);
    expect(readlinkSync(join(proj, '.agents/skills/tdd'))).toBe('../../../clone/skills/tdd');
    expect(existsSync(join(proj, '.claude'))).toBe(false);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('is the source itself'));
  });

  it('refuses to replace a symlink the source is reached through via an alias dir', async () => {
    mkdirSync(join(proj, '.agents/skills'), { recursive: true });
    symlinkSync('../../../clone/skills/tdd', join(proj, '.agents/skills/tdd'));
    symlinkSync('.agents', join(proj, 'alias'));
    expect(await runSymlink(['alias', '-s', 'tdd', '-a', 'codex', '-y'], { cwd: proj })).toBe(1);
    expect(readlinkSync(join(proj, '.agents/skills/tdd'))).toBe('../../../clone/skills/tdd');
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('is the source itself'));
  });

  it('follows a link target with symlink/.. physically, not lexically', async () => {
    seedSkill(join(proj, '.agents/skills/victim'), 'unused');
    mkdirSync(join(proj, '.agents/skills/victim/deep'));
    mkdirSync(join(proj, '.agents/skills/victim/actual'));
    writeFileSync(join(proj, '.agents/skills/victim/actual/SKILL.md'), '---\nname: tdd\n---\n');
    seedSkill(clone, 'victim');
    rmSync(join(clone, 'skills/tdd'), { recursive: true, force: true });
    symlinkSync(join(proj, '.agents/skills/victim/deep'), join(clone, 'skills/bridge'));
    symlinkSync('bridge/../actual', join(clone, 'skills/tdd'));
    expect(
      await runSymlink(['../clone', '-s', 'victim', 'tdd', '-a', 'codex', '-y'], { cwd: proj }),
    ).toBe(1);
    expect(existsSync(join(proj, '.agents/skills/victim/actual/SKILL.md'))).toBe(true);
  });

  it('replaces a foreign and a dangling symlink with -y', async () => {
    mkdirSync(join(proj, '.agents/skills'), { recursive: true });
    symlinkSync('../../../clone/skills/cross-review', join(proj, '.agents/skills/tdd'));
    symlinkSync('../../nowhere', join(proj, '.agents/skills/cross-review'));
    expect(
      await runSymlink(['../clone', '-s', 'tdd', 'cross-review', '-a', 'codex', '-y'], {
        cwd: proj,
      }),
    ).toBe(0);
    expect(readlinkSync(join(proj, '.agents/skills/tdd'))).toBe('../../../clone/skills/tdd');
    expect(readlinkSync(join(proj, '.agents/skills/cross-review'))).toBe(
      '../../../clone/skills/cross-review',
    );
  });

  it('refuses to replace a folder that holds the source of another selected skill', async () => {
    seedSkill(join(proj, '.agents/skills/tdd'), 'nested');
    rmSync(join(clone, 'skills/cross-review'), { recursive: true, force: true });
    symlinkSync(join(proj, '.agents/skills/tdd/skills/nested'), join(clone, 'skills/cross-review'));
    expect(await runSymlink(['../clone', '-s', 'tdd', 'cross-review', '-y'], { cwd: proj })).toBe(
      1,
    );
    expect(existsSync(join(proj, '.agents/skills/tdd/skills/nested/SKILL.md'))).toBe(true);
  });

  it('computes the target from the physical dir when .agents/skills is a symlink', async () => {
    const shared = join(tmp, 'shared/deep/skills');
    mkdirSync(shared, { recursive: true });
    mkdirSync(join(proj, '.agents'));
    symlinkSync(shared, join(proj, '.agents/skills'));
    expect(await runSymlink(['../clone', '-s', 'tdd', '-a', 'codex', '-y'], { cwd: proj })).toBe(0);
    expect(existsSync(join(proj, '.agents/skills/tdd/SKILL.md'))).toBe(true);
    expect(realpathSync(join(proj, '.agents/skills/tdd'))).toBe(join(clone, 'skills/tdd'));
  });

  it('links once when .claude/skills is a symlink to .agents/skills', async () => {
    mkdirSync(join(proj, '.agents/skills'), { recursive: true });
    mkdirSync(join(proj, '.claude'));
    symlinkSync('../.agents/skills', join(proj, '.claude/skills'));
    expect(await runSymlink(['../clone', '-s', 'tdd', '-y'], { cwd: proj })).toBe(0);
    expect(existsSync(join(proj, '.claude/skills/tdd/SKILL.md'))).toBe(true);
    expect(realpathSync(join(proj, '.agents/skills/tdd'))).toBe(join(clone, 'skills/tdd'));
  });

  it('planSymlinks marks a plain file as replace', () => {
    mkdirSync(join(proj, '.claude/skills'), { recursive: true });
    writeFileSync(join(proj, '.claude/skills/tdd'), 'not a skill');
    const [step] = planSymlinks({
      cwd: proj,
      skillsAbs: join(clone, 'skills'),
      names: ['tdd'],
      dirs: ['.claude/skills'],
    });
    expect(step).toMatchObject({ action: 'replace', existing: 'file' });
  });

  it('fails when the source is not a directory', async () => {
    expect(await runSymlink(['../missing', '-s', 'tdd'], { cwd: proj })).toBe(1);
    expect(console.error).toHaveBeenCalledWith('skl sln: ../missing is not a local directory');
  });

  it('dedupes repeated names', async () => {
    expect(await runSymlink(['../clone', '-s', 'tdd', 'tdd', '-y'], { cwd: proj })).toBe(0);
    expect(console.log).toHaveBeenCalledWith(
      'Symlinking 1 skill from ../clone to Project scope ██████████ 100%',
    );
    expect(console.log).toHaveBeenCalledWith('Symlinked 1 skill to Project scope · tdd');
  });

  it('returns 1 on argument errors', async () => {
    expect(await runSymlink(['-s', 'tdd'], { cwd: proj })).toBe(1);
    expect(console.error).toHaveBeenCalledWith('skl sln: missing <path>');
  });

  function seedInternal(root: string, name: string): void {
    mkdirSync(join(root, 'skills', name), { recursive: true });
    writeFileSync(
      join(root, 'skills', name, 'SKILL.md'),
      `---\nname: ${name}\nmetadata:\n  internal: true\n---\n`,
    );
  }

  it('without -s links every skill except internal ones and dirs without SKILL.md', async () => {
    seedInternal(clone, 'hidden');
    mkdirSync(join(clone, 'skills', 'notes'));
    mkdirSync(join(clone, 'skills', 'public'), { recursive: true });
    writeFileSync(
      join(clone, 'skills', 'public', 'SKILL.md'),
      '---\nname: public\nmetadata:\n  internal: false\n---\n',
    );
    expect(await runSymlink(['../clone', '-y'], { cwd: proj })).toBe(0);
    expect(existsSync(join(proj, '.claude/skills/public'))).toBe(true);
    rmSync(join(proj, '.agents/skills/public'));
    rmSync(join(proj, '.claude/skills/public'));
    rmSync(join(clone, 'skills', 'public'), { recursive: true });
    vi.mocked(console.log).mockClear();
    expect(await runSymlink(['../clone', '-y'], { cwd: proj })).toBe(0);
    for (const dir of BOTH) {
      expect(readlinkSync(join(proj, dir, 'tdd'))).toBe('../../../clone/skills/tdd');
      expect(readlinkSync(join(proj, dir, 'cross-review'))).toBe(
        '../../../clone/skills/cross-review',
      );
      expect(existsSync(join(proj, dir, 'hidden'))).toBe(false);
      expect(existsSync(join(proj, dir, 'notes'))).toBe(false);
    }
    expect(console.log).toHaveBeenCalledWith(
      'Symlinking 2 skills from ../clone to Project scope ██████████ 100%',
    );
    expect(console.log).toHaveBeenCalledWith(
      'Symlinked 2 skills to Project scope · cross-review tdd',
    );
    expect(console.log).toHaveBeenCalledWith(
      'skill         .agents    .claude    skills-lock.json  cost',
    );
    expect(console.log).toHaveBeenCalledWith(
      'cross-review  symlinked  symlinked  -                 ~7 tok',
    );
    expect(console.log).toHaveBeenCalledWith(
      'tdd           symlinked  symlinked  -                 ~4 tok',
    );
  });

  it('prints "No skills to symlink" and no table when every -s name is skipped', async () => {
    expect(await runSymlink(['../clone', '-s', ' tdd', '-y'], { cwd: proj })).toBe(0);
    expect(vi.mocked(console.log).mock.calls).toEqual([['No skills to symlink in ../clone.']]);
    expect(existsSync(join(proj, '.agents'))).toBe(false);
  });

  it('links an internal skill named with -s', async () => {
    seedInternal(clone, 'hidden');
    expect(await runSymlink(['../clone', '-s', 'hidden', '-y'], { cwd: proj })).toBe(0);
    expect(existsSync(join(proj, '.agents/skills/hidden'))).toBe(true);
  });

  it('without -s skips an internal skill marked with a trailing YAML comment', async () => {
    mkdirSync(join(clone, 'skills', 'hidden'), { recursive: true });
    writeFileSync(
      join(clone, 'skills', 'hidden', 'SKILL.md'),
      '---\nname: hidden\nmetadata:\n  internal: true # private\n---\n',
    );
    expect(await runSymlink(['../clone', '-y'], { cwd: proj })).toBe(0);
    for (const dir of BOTH) {
      expect(existsSync(join(proj, dir, 'tdd'))).toBe(true);
      expect(existsSync(join(proj, dir, 'hidden'))).toBe(false);
    }
  });

  it('-x skips the listed skills', async () => {
    expect(await runSymlink(['../clone', '-x', 'tdd', '-y'], { cwd: proj })).toBe(0);
    expect(existsSync(join(proj, '.agents/skills/cross-review'))).toBe(true);
    expect(existsSync(join(proj, '.agents/skills/tdd'))).toBe(false);
  });

  it('-x with a name not in the clone fails before any change', async () => {
    expect(await runSymlink(['../clone', '-x', 'nope', '-y'], { cwd: proj })).toBe(1);
    expect(console.error).toHaveBeenCalledWith(
      `skl sln: --reject: "nope" is not in ${join('../clone', 'skills')}`,
    );
    expect(existsSync(join(proj, '.agents'))).toBe(false);
  });

  it('prints "No skills to symlink" when every skill is rejected or the clone is empty', async () => {
    expect(await runSymlink(['../clone', '-x', 'tdd', 'cross-review'], { cwd: proj })).toBe(0);
    expect(console.log).toHaveBeenCalledWith('No skills to symlink in ../clone.');
    mkdirSync(join(tmp, 'empty'));
    expect(await runSymlink(['../empty'], { cwd: proj })).toBe(0);
    expect(console.log).toHaveBeenCalledWith('No skills to symlink in ../empty.');
    expect(existsSync(join(proj, '.agents'))).toBe(false);
  });

  it('marks skills that are in skills-lock.json with + in the table', async () => {
    writeFileSync(join(proj, 'skills-lock.json'), JSON.stringify({ skills: { tdd: {} } }));
    expect(await runSymlink(['../clone', '-s', 'tdd', '-y'], { cwd: proj })).toBe(0);
    expect(console.log).toHaveBeenCalledWith(
      'tdd    symlinked  symlinked  +                 ~4 tok',
    );
  });

  const logged = () => vi.mocked(console.log).mock.calls.map((c) => c[0]);

  it.each([[[]], [['-m', 'lg']], [['-m', 'md']]])(
    'runSln %j prints the progress line, the table and the summary, no links or skips',
    async (mode) => {
      seedInternal(clone, 'hidden');
      mkdirSync(join(proj, '.agents/skills/tdd'), { recursive: true });
      expect(await runSln(['../clone', '-x', 'cross-review', '-y', ...mode], { cwd: proj })).toBe(
        0,
      );
      expect(logged()).toEqual([
        'Symlinking 1 skill from ../clone to Project scope ██████████ 100%',
        'skill  .agents    .claude    skills-lock.json  cost',
        'tdd    symlinked  symlinked  -                 ~4 tok',
        'Symlinked 1 skill to Project scope · tdd',
      ]);
    },
  );

  it('runSln --mode small prints the summary only and still links', async () => {
    expect(await runSln(['../clone', '--mode', 'small', '-y'], { cwd: proj })).toBe(0);
    expect(logged()).toEqual(['Symlinked 2 skills to Project scope · cross-review tdd']);
    expect(lstatSync(join(proj, '.claude/skills/tdd')).isSymbolicLink()).toBe(true);
  });

  it('runSln: "No skills to symlink" alone in every mode', async () => {
    expect(await runSln(['../clone', '-x', 'tdd', 'cross-review'], { cwd: proj })).toBe(0);
    expect(logged()).toEqual(['No skills to symlink in ../clone.']);
    vi.mocked(console.log).mockClear();
    expect(await runSln(['../clone', '-s', ' tdd', '-y', '-m', 'sm'], { cwd: proj })).toBe(0);
    expect(logged()).toEqual(['No skills to symlink in ../clone.']);
    expect(existsSync(join(proj, '.agents'))).toBe(false);
  });

  it('runSln prints its help and rejects conflicting modes before any change', async () => {
    expect(await runSln(['-h'], { cwd: proj })).toBe(0);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('USAGE skl-x sln <path>'));
    expect(await runSln(['../clone', '-y', '-m', 'md', '-m', 'sm'], { cwd: proj })).toBe(1);
    expect(console.error).toHaveBeenCalledWith('skl sln: conflicting modes: md and sm');
    expect(existsSync(join(proj, '.agents'))).toBe(false);
  });

  it('takes a path that is the skills folder itself, with and without -s', async () => {
    seedInternal(clone, 'hidden');
    expect(await runSymlink(['../clone/skills', '-s', 'tdd', '-y'], { cwd: proj })).toBe(0);
    expect(readlinkSync(join(proj, '.agents/skills/tdd'))).toBe('../../../clone/skills/tdd');
    expect(console.log).toHaveBeenCalledWith(
      'Symlinking 1 skill from ../clone/skills to Project scope ██████████ 100%',
    );
    expect(await runSymlink(['../clone/skills', '-y'], { cwd: proj })).toBe(0);
    for (const dir of BOTH) {
      expect(readlinkSync(join(proj, dir, 'cross-review'))).toBe(
        '../../../clone/skills/cross-review',
      );
      expect(existsSync(join(proj, dir, 'hidden'))).toBe(false);
    }
  });

  it('prefers <path>/skills when <path> also holds skill folders', async () => {
    mkdirSync(join(clone, 'stray'));
    writeFileSync(join(clone, 'stray', 'SKILL.md'), '---\nname: stray\n---\n');
    expect(await runSymlink(['../clone', '-y'], { cwd: proj })).toBe(0);
    expect(existsSync(join(proj, '.agents/skills/tdd'))).toBe(true);
    expect(existsSync(join(proj, '.agents/skills/stray'))).toBe(false);
  });

  it('names the skills folder itself in errors for that path form', async () => {
    expect(await runSymlink(['../clone/skills', '-s', 'nope', '-y'], { cwd: proj })).toBe(1);
    expect(console.error).toHaveBeenCalledWith(
      `skl sln: ${join('../clone/skills', 'nope', 'SKILL.md')} not found`,
    );
    expect(await runSymlink(['../clone/skills', '-x', 'nope', '-y'], { cwd: proj })).toBe(1);
    expect(console.error).toHaveBeenCalledWith(
      'skl sln: --reject: "nope" is not in ../clone/skills',
    );
    expect(existsSync(join(proj, '.agents'))).toBe(false);
  });

  describe('a repo without <path>/skills (recursive search)', () => {
    let repo = '';
    beforeEach(() => {
      repo = join(tmp, 'repo');
      seedSkill(join(repo, 'plugins/devflow'), 'tdd');
      seedSkill(join(repo, 'plugins/devflow'), 'branch-finish');
      seedSkill(join(repo, 'plugins/writing'), 'dashfix');
      seedInternal(join(repo, 'plugins/writing'), 'hidden');
      // a skills folder without SKILL.md files does not stop the search
      mkdirSync(join(repo, 'skills/leftover'), { recursive: true });
    });

    it('finds -s skills in whichever folder holds them, skipping " name"', async () => {
      expect(
        await runSymlink(['../repo', '-s', 'branch-finish', 'dashfix', ' tdd', '-y'], {
          cwd: proj,
        }),
      ).toBe(0);
      expect(readlinkSync(join(proj, '.agents/skills/branch-finish'))).toBe(
        '../../../repo/plugins/devflow/skills/branch-finish',
      );
      expect(readlinkSync(join(proj, '.claude/skills/dashfix'))).toBe(
        '../../../repo/plugins/writing/skills/dashfix',
      );
      expect(existsSync(join(proj, '.agents/skills/tdd'))).toBe(false);
      expect(console.log).toHaveBeenCalledWith(
        'Symlinking 2 skills from ../repo to Project scope ██████████ 100%',
      );
    });

    it('links every found skill without -s, except internal ones', async () => {
      expect(await runSymlink(['../repo', '-x', 'tdd', '-y'], { cwd: proj })).toBe(0);
      expect(readdirSync(join(proj, '.agents/skills')).sort()).toEqual([
        'branch-finish',
        'dashfix',
      ]);
    });

    it('skips a SKILL.md named after another skill, and says so for -s', async () => {
      mkdirSync(join(repo, 'misc/old-name'), { recursive: true });
      writeFileSync(join(repo, 'misc/old-name/SKILL.md'), '---\nname: new-name\n---\n');
      expect(await runSymlink(['../repo', '-s', 'old-name', '-y'], { cwd: proj })).toBe(1);
      expect(console.error).toHaveBeenCalledWith(
        'skl sln: ../repo/misc/old-name/SKILL.md is not named old-name in its frontmatter',
      );
      expect(await runSymlink(['../repo', '-s', 'nope', '-y'], { cwd: proj })).toBe(1);
      expect(console.error).toHaveBeenCalledWith('skl sln: no nope/SKILL.md in ../repo');
      expect(existsSync(join(proj, '.agents'))).toBe(false);
      expect(await runSymlink(['../repo', '-y'], { cwd: proj })).toBe(0);
      expect(existsSync(join(proj, '.agents/skills/old-name'))).toBe(false);
    });

    it('skips hidden folders, node_modules, symlinks, the inside of a skill and deep folders', async () => {
      seedSkill(join(repo, '.agents'), 'copy');
      seedSkill(join(repo, 'node_modules/pkg'), 'dep');
      seedSkill(join(repo, 'tool'), 'kit');
      // depth 5, inside the kit skill
      seedSkill(join(repo, 'tool/skills/kit'), 'inner');
      seedSkill(join(repo, 'a/b/c/d'), 'too-deep');
      seedSkill(join(repo, 'a/b/c'), 'deep-enough');
      symlinkSync(join(repo, 'plugins'), join(repo, 'loop'));
      expect(await runSymlink(['../repo', '-y'], { cwd: proj })).toBe(0);
      expect(readdirSync(join(proj, '.agents/skills')).sort()).toEqual([
        'branch-finish',
        'dashfix',
        'deep-enough',
        'kit',
        'tdd',
      ]);
    });

    it('refuses a skill that is in two folders', async () => {
      seedSkill(join(repo, 'plugins/writing'), 'tdd');
      expect(await runSymlink(['../repo', '-s', 'tdd', '-y'], { cwd: proj })).toBe(1);
      expect(console.error).toHaveBeenCalledWith(
        'skl sln: tdd is in more than one folder: ../repo/plugins/devflow/skills, ../repo/plugins/writing/skills',
      );
      // other skills still link
      expect(await runSymlink(['../repo', '-s', 'dashfix', '-y'], { cwd: proj })).toBe(0);
    });
  });
});
