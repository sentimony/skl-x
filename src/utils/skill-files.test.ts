import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  countFrontmatterTokens,
  estimateContextTokens,
  extractFrontmatter,
  findSkillFile,
  formatCost,
  getSkillPathCandidates,
  parseSkillMeta,
  readSkillCost,
} from './skill-files';

describe('extractFrontmatter', () => {
  it('extracts content between --- markers', () => {
    const fm = extractFrontmatter('---\nname: x\ndescription: y\n---\n\n# Body\n');
    expect(fm).toBe('name: x\ndescription: y');
  });
  it('returns undefined when no frontmatter', () => {
    expect(extractFrontmatter('# Just a heading\n')).toBeUndefined();
  });
  it('handles CRLF line endings', () => {
    const fm = extractFrontmatter('---\r\nname: x\r\n---\r\n\r\n# Body');
    expect(fm).toBe('name: x');
  });
});

describe('parseSkillMeta', () => {
  it('reads internal from the metadata block', () => {
    const fm = (v: string) => `name: a\nmetadata:\n  author: x\n  internal: ${v}\nlicense: MIT`;
    expect(parseSkillMeta(fm('true')).internal).toBe(true);
    expect(parseSkillMeta(fm('"true"')).internal).toBe(true);
    expect(parseSkillMeta(fm('false')).internal).toBe(false);
    expect(parseSkillMeta(fm('true # private')).internal).toBe(true);
    expect(parseSkillMeta(fm("'true' # c")).internal).toBe(true);
    expect(parseSkillMeta(fm('"true # x"')).internal).toBe(false);
    expect(parseSkillMeta('name: a\ninternal: true').internal).toBe(false);
    expect(parseSkillMeta('name: a').internal).toBe(false);
  });
  it('reads single-line name and description', () => {
    expect(parseSkillMeta('name: foo\ndescription: Does foo.')).toEqual({
      name: 'foo',
      description: 'Does foo.',
      disableModelInvocation: false,
      internal: false,
    });
  });
  it('joins indented continuation lines with a space', () => {
    const meta = parseSkillMeta('name: foo\ndescription: Line one\n  line two\nlicense: MIT');
    expect(meta.description).toBe('Line one line two');
  });
  it('drops folded and literal block indicators', () => {
    expect(parseSkillMeta('description: >\n  folded\n  text').description).toBe('folded text');
    expect(parseSkillMeta('description: |-\n  literal\n  text').description).toBe('literal text');
  });
  it('strips surrounding quotes', () => {
    expect(parseSkillMeta('name: "foo"\ndescription: \'Does: foo\'')).toMatchObject({
      name: 'foo',
      description: 'Does: foo',
    });
  });
  it('ignores nested keys with the same name', () => {
    const meta = parseSkillMeta('name: foo\nmetadata:\n  description: nested\n  name: bar');
    expect(meta).toMatchObject({ name: 'foo', description: undefined });
  });
  it('reads disable-model-invocation', () => {
    expect(parseSkillMeta('disable-model-invocation: true').disableModelInvocation).toBe(true);
    expect(parseSkillMeta('disable-model-invocation: false').disableModelInvocation).toBe(false);
    expect(parseSkillMeta('name: foo').disableModelInvocation).toBe(false);
  });
  it('handles CRLF line endings', () => {
    expect(parseSkillMeta('name: foo\r\ndescription: bar\r\n').description).toBe('bar');
  });
});

describe('estimateContextTokens', () => {
  it('counts name + description at 3 chars per token', () => {
    // 3 + 9 = 12 chars -> 4 tokens
    expect(estimateContextTokens({ name: 'foo', description: 'Does foo.' }, 'dir')).toBe(4);
  });
  it('falls back to the directory name when name is absent', () => {
    // 6 + 0 = 6 chars -> 2 tokens
    expect(estimateContextTokens({}, 'foobar')).toBe(2);
  });
  it('ignores fields other than name and description', () => {
    const fm = 'name: foo\ndescription: Does foo.\ncompatibility: a very long field value';
    expect(estimateContextTokens(parseSkillMeta(fm), 'foo')).toBe(4);
  });
});

describe('getSkillPathCandidates', () => {
  it('returns single local path next to lock file', () => {
    const paths = getSkillPathCandidates('foo', '/repo/skills-lock.json', false);
    expect(paths).toEqual(['/repo/.claude/skills/foo/SKILL.md']);
  });
  it('returns global candidates when isGlobal=true', () => {
    const paths = getSkillPathCandidates('foo', '/anywhere/.skill-lock.json', true);
    expect(paths.length).toBe(2);
    expect(paths[0]).toContain('.claude/skills/foo/SKILL.md');
    expect(paths[1]).toContain('.agents/skills/foo/SKILL.md');
  });
});

describe('findSkillFile + countFrontmatterTokens', () => {
  let TMP = '';
  beforeEach(() => {
    TMP = join(tmpdir(), `skl-x-skf-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(join(TMP, '.claude', 'skills', 'present'), { recursive: true });
    writeFileSync(
      join(TMP, '.claude', 'skills', 'present', 'SKILL.md'),
      '---\nname: present\ndescription: hi\n---\n\n# Body\n',
    );
    writeFileSync(join(TMP, 'skills-lock.json'), '{}');
  });
  afterEach(() => rmSync(TMP, { recursive: true, force: true }));

  it('finds an existing skill file', () => {
    const f = findSkillFile('present', join(TMP, 'skills-lock.json'), false);
    expect(f).toContain('present/SKILL.md');
  });
  it('returns undefined for missing skill', () => {
    const f = findSkillFile('absent', join(TMP, 'skills-lock.json'), false);
    expect(f).toBeUndefined();
  });
  it('counts context tokens from name + description', () => {
    const f = findSkillFile('present', join(TMP, 'skills-lock.json'), false);
    // 'present' + 'hi' = 9 chars -> 3 tokens
    expect(countFrontmatterTokens(f as string)).toBe(3);
  });
});

describe('readSkillCost', () => {
  let dir = '';
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const write = (body: string) => {
    dir = mkdtempSync(join(tmpdir(), 'skl-cost-'));
    writeFileSync(join(dir, 'SKILL.md'), body);
    return join(dir, 'SKILL.md');
  };

  it('estimates name + description at 3 chars per token', () => {
    // 'skill-bar' (9) + 'write a plan from a spec' (24) = 33 chars
    expect(
      readSkillCost(
        write('---\nname: skill-bar\ndescription: write a plan from a spec\n---\n'),
        'x',
      ),
    ).toBe(11);
  });

  it('marks disable-model-invocation as hidden', () => {
    expect(readSkillCost(write('---\nname: a\ndisable-model-invocation: true\n---\n'), 'a')).toBe(
      'hidden',
    );
  });

  it('reports a file without frontmatter', () => {
    expect(readSkillCost(write('# no frontmatter\n'), 'a')).toBe('no-frontmatter');
  });

  it('reports a missing file', () => {
    expect(readSkillCost(undefined, 'a')).toBe('missing');
    expect(readSkillCost('/nonexistent/SKILL.md', 'a')).toBe('missing');
  });
});

describe('formatCost', () => {
  it('formats every cost kind as skl cost does', () => {
    expect(formatCost(262)).toBe('~262 tok');
    expect(formatCost(2882)).toBe('~2,882 tok');
    expect(formatCost('missing')).toBe('~? tok');
    expect(formatCost('no-frontmatter')).toBe('(no frontmatter)');
    expect(formatCost('hidden')).toBe('-');
  });
});
