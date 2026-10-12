import { afterEach, describe, expect, it, vi } from 'vitest';
import { setColorEnabled } from './ansi';
import { createProgress, INTRO_CELLS, INTRO_STEP_MS, renderBar } from './progress';

afterEach(() => {
  vi.restoreAllMocks();
  setColorEnabled(false);
});

describe('renderBar', () => {
  it('fills whole cells, ten percent each', () => {
    expect(renderBar(0)).toBe('░░░░░░░░░░ 0%');
    expect(renderBar(0.28)).toBe('██░░░░░░░░ 20%');
    expect(renderBar(1)).toBe('██████████ 100%');
  });

  it('paints the cells green and leaves the percent plain', () => {
    setColorEnabled(true);
    expect(renderBar(0.25)).toBe('\x1b[32m██░░░░░░░░\x1b[0m 20%');
  });
});

describe('createProgress', () => {
  const tty = (columns?: number) => {
    const writes: string[] = [];
    return { writes, out: { isTTY: true, columns, write: (s: string) => void writes.push(s) } };
  };
  const frames = (writes: string[]) =>
    writes.filter((w) => w !== '\r\x1b[2K').map((w) => w.replace('\r\x1b[2K', ''));

  it('draws nothing until start, then fills seven cells 150 ms apart', () => {
    vi.useFakeTimers();
    const { writes, out } = tty();
    const p = createProgress('Installing', out);
    p.update(0.5);
    expect(writes).toEqual([]);
    p.start();
    expect(frames(writes)).toEqual(['Installing █░░░░░░░░░ 10%']);
    vi.advanceTimersByTime(INTRO_STEP_MS * 5);
    expect(frames(writes).at(-1)).toBe('Installing ██████░░░░ 60%');
    vi.advanceTimersByTime(INTRO_STEP_MS);
    // the intro is full, so the stored fraction shows in the cells after it
    expect(frames(writes).at(-1)).toBe('Installing ████████░░ 80%');
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  it('maps the fraction onto the last three cells, never the tenth before done', () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { writes, out } = tty();
    const p = createProgress('Installing', out);
    p.start();
    vi.advanceTimersByTime(INTRO_STEP_MS * INTRO_CELLS);
    expect(frames(writes).at(-1)).toBe('Installing ███████░░░ 70%');
    p.update(1 / 3);
    expect(frames(writes).at(-1)).toBe('Installing ████████░░ 80%');
    p.update(0.99);
    expect(frames(writes).at(-1)).toBe('Installing █████████░ 90%');
    p.update(0.99);
    expect(writes.length).toBe(INTRO_CELLS + 2);
    p.done('Installing 1 skill');
    expect(writes.at(-1)).toBe('\r\x1b[2K');
    expect(console.log).toHaveBeenCalledWith('Installing 1 skill ██████████ 100%');
    vi.useRealTimers();
  });

  it('prints only the final line outside a TTY', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const writes: string[] = [];
    const p = createProgress('Installing', { isTTY: false, write: (s) => void writes.push(s) });
    p.start();
    p.update(0.5);
    p.done();
    expect(writes).toEqual([]);
    expect(log.mock.calls).toEqual([['Installing ██████████ 100%']]);
  });

  it('shortens the label so a frame fits one terminal row', () => {
    const { writes, out } = tty(40);
    const p = createProgress('Installing from /Users/someone/work/github/sentimony/skills', out);
    p.start();
    p.fail();
    // 40 columns - 1 spare - 16 for " ██████████ 100%" leaves 23 for the label
    expect(writes[0]).toBe('\r\x1b[2KInstalling from /Users… █░░░░░░░░░ 10%');
    expect(writes[0]?.replace('\r\x1b[2K', '').length).toBeLessThan(40);
  });

  it('keeps the whole label in the final line', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const p = createProgress('Installing from https://github.com/a/b', tty(20).out);
    p.start();
    p.done();
    expect(log).toHaveBeenCalledWith('Installing from https://github.com/a/b ██████████ 100%');
  });

  it('keeps the partial bar on failure in a TTY and prints the label outside one', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { writes, out } = tty();
    const p = createProgress('Installing', out);
    p.start();
    p.fail();
    expect(writes.at(-1)).toBe('\n');
    createProgress('Installing', { isTTY: false, write: () => {} }).fail();
    expect(log.mock.calls).toEqual([['Installing']]);
  });
});
