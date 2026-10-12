import { describe, expect, it } from 'vitest';
import { extractMode } from './mode';

describe('extractMode', () => {
  it.each([
    [['a', '-m', 'md', '-y'], 'md', ['a', '-y']],
    [['a', '--mode', 'medium'], 'md', ['a']],
    [['--mode=md', 'a'], 'md', ['a']],
    [['-m', 'medium', 'a', '-m', 'md'], 'md', ['a']],
    [['a', '-m', 'sm'], 'sm', ['a']],
    [['a', '--mode=small'], 'sm', ['a']],
    [['-m', 'lg', 'a'], 'lg', ['a']],
    [['a', '--mode', 'large'], 'lg', ['a']],
  ])('%j -> %s', (argv, mode, rest) => {
    expect(extractMode(argv)).toEqual({ kind: 'ok', mode, rest });
  });

  it('defaults to lg and keeps the argv without -m', () => {
    expect(extractMode(['a', '-y'])).toEqual({ kind: 'ok', mode: 'lg', rest: ['a', '-y'] });
  });

  it.each([
    [['-m'], '-m needs a value: sm (small), md (medium) or lg (large)'],
    [['-m', '-y'], '-m needs a value: sm (small), md (medium) or lg (large)'],
    [['--mode'], '--mode needs a value: sm (small), md (medium) or lg (large)'],
    [['--mode', 'loud'], 'unknown mode "loud", use sm (small), md (medium) or lg (large)'],
    [['--mode='], 'unknown mode "", use sm (small), md (medium) or lg (large)'],
    [['-m', 'md', '-m', 'sm'], 'conflicting modes: md and sm'],
    [['--mode=large', '-m', 'md'], 'conflicting modes: lg and md'],
    [['-m', 's'], 'mode "s" was renamed in 0.4.8, use md'],
    [['--mode=quiet'], 'mode "quiet" was renamed in 0.4.8, use sm'],
    [['-m', 'c'], 'mode "c" was renamed in 0.4.8, use lg'],
  ])('rejects %j', (argv, message) => {
    expect(extractMode(argv)).toEqual({ kind: 'error', message });
  });
});
