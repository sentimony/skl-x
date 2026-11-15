import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';
import { setColorEnabled } from '../utils/ansi';
import { encodeClaudeProjectDir } from '../utils/scope';
import { hasRemovedUsageFlag, renderUsageTable, runUsage, type UsageArgs } from './usage';

// Bun's os.homedir() ignores a stubbed HOME (CI runs vitest through bun), so read it from env
vi.mock('node:os', async (importOriginal) => {
  const os = await importOriginal<typeof import('node:os')>();
  return { ...os, homedir: () => process.env.HOME ?? os.homedir() };
});

afterEach(() => setColorEnabled(false));

describe('runUsage', () => {
  let home: string;
  let project: string;
  let log: MockInstance<typeof console.log>;
  let error: MockInstance<typeof console.log>;

  const args = (over: Partial<UsageArgs> = {}): UsageArgs => ({
    period: 'all',
    format: 'text',
    'scan-all-files': false,
    ...over,
  });
  const printed = (spy: MockInstance<typeof console.log>) => spy.mock.calls.map((c) => c[0]);

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), 'skl-usg-unit-')));
    project = join(home, 'project');
    mkdirSync(join(project, '.git'), { recursive: true });
    vi.stubEnv('HOME', home);
    vi.spyOn(process, 'cwd').mockReturnValue(project);
    vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`exit ${code}`);
    });
    log = vi.spyOn(console, 'log').mockImplementation(() => {});
    error = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('reports no usage when neither agent has a session dir', async () => {
    await runUsage(args());
    expect(printed(log)).toEqual(['Project scope · Usage 0 times by all', 'No skill usage by all']);
    expect(error).not.toHaveBeenCalled();
  });

  it('in a subdirectory reads the skills of the repo root', async () => {
    writeFileSync(join(project, 'skills-lock.json'), JSON.stringify({ skills: { tdd: {} } }));
    mkdirSync(join(project, '.claude', 'skills', 'tdd'), { recursive: true });
    writeFileSync(
      join(project, '.claude', 'skills', 'tdd', 'SKILL.md'),
      '---\nname: tdd\ndescription: x\n---\n',
    );
    const sessions = join(home, '.claude', 'projects', encodeClaudeProjectDir(project));
    mkdirSync(sessions, { recursive: true });
    writeFileSync(
      join(sessions, 's.jsonl'),
      `${JSON.stringify({ type: 'summary', timestamp: new Date().toISOString(), attributionSkill: 'tdd' })}\n`,
    );
    const sub = join(project, 'src');
    mkdirSync(sub);
    vi.spyOn(process, 'cwd').mockReturnValue(sub);
    await runUsage(args({ agent: 'claude-code', mode: 'attributed' }));
    expect(printed(log)[0]).toBe('Project scope · Usage 1 time by all');
    expect(printed(log).join('\n')).toMatch(/^tdd +1 +~1 tok/m);
  });

  it('treats $HOME as a project: its own sessions and skills only', async () => {
    const entry = (skill: string) =>
      `${JSON.stringify({ type: 'summary', timestamp: new Date().toISOString(), attributionSkill: skill })}\n`;
    const sessions = (dir: string) =>
      join(home, '.claude', 'projects', encodeClaudeProjectDir(dir));
    mkdirSync(sessions(home), { recursive: true });
    writeFileSync(join(sessions(home), 'h.jsonl'), entry('tdd'));
    mkdirSync(sessions(project), { recursive: true });
    writeFileSync(join(sessions(project), 'p.jsonl'), entry('other'));
    mkdirSync(join(home, '.claude', 'skills', 'tdd'), { recursive: true });
    writeFileSync(
      join(home, '.claude', 'skills', 'tdd', 'SKILL.md'),
      '---\nname: tdd\ndescription: x\n---\n',
    );
    vi.spyOn(process, 'cwd').mockReturnValue(home);
    await runUsage(args({ agent: 'claude-code', mode: 'attributed' }));
    const out = printed(log);
    expect(out[0]).toBe('Project scope · Usage 1 time by all');
    expect(out.join('\n')).toMatch(/^tdd +1 +~1 tok/m);
    expect(out.join('\n')).not.toContain('other');
  });
});

describe('renderUsageTable', () => {
  it('renders the spec table with sums', () => {
    expect(
      renderUsageTable(
        [
          { name: 'hibob-scrapppp', counts: { codex: 11 }, cost: 262 },
          { name: 'hibob-scraping', counts: { codex: 11, 'claude-code': 0 }, cost: 262 },
        ],
        ['claude-code', 'codex'],
      ),
    ).toEqual([
      'skill           .agents  .claude      cost       total',
      'hibob-scraping       11        0  ~262 tok  ~2,882 tok',
      'hibob-scrapppp       11        0  ~262 tok  ~2,882 tok',
      '2 skills             22        0  ~524 tok  ~5,764 tok',
    ]);
  });

  it('shows only the selected agent, sorts by runs then name, keeps non-numeric costs', () => {
    expect(
      renderUsageTable(
        [
          { name: 'a', counts: { codex: 1 }, cost: 'missing' },
          { name: 'c', counts: { codex: 3 }, cost: 1000 },
          { name: 'b', counts: { codex: 3 }, cost: 'hidden' },
        ],
        ['codex'],
      ),
    ).toEqual([
      'skill     .agents        cost       total',
      'b               3           -           -',
      'c               3  ~1,000 tok  ~3,000 tok',
      'a               1      ~? tok      ~? tok',
      '3 skills        7  ~1,000 tok  ~3,000 tok',
    ]);
  });

  it('paints a missing skill red and others cyan', () => {
    setColorEnabled(true);
    const lines = renderUsageTable(
      [
        { name: 'gone', counts: { codex: 1 }, cost: 'missing' },
        { name: 'tdd', counts: { codex: 2 }, cost: 1 },
      ],
      ['codex'],
    );
    expect(lines[1]?.startsWith('\x1b[36mtdd\x1b[0m')).toBe(true);
    expect(lines[2]?.startsWith('\x1b[31mgone\x1b[0m')).toBe(true);
  });
});

describe('hasRemovedUsageFlag', () => {
  it.each([['-g'], ['--global'], ['--global=true'], ['--root', '/x'], ['--root=/x']])(
    'flags %s',
    (...args) => {
      expect(hasRemovedUsageFlag(['-p', '2d', ...args])).toBe(true);
    },
  );

  it('accepts the remaining flags', () => {
    expect(
      hasRemovedUsageFlag(['-a', 'codex', '-p', '2d', '--mode', 'mentions', '--scan-all-files']),
    ).toBe(false);
  });
});
