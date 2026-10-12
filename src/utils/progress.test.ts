import { afterEach, describe, expect, it, vi } from 'vitest';
import { setColorEnabled } from './ansi';
import { createProgress, FRAME_MS, INTRO_CELLS, renderBar } from './progress';

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

  it('paints the cells green and the percent gray', () => {
    setColorEnabled(true);
    expect(renderBar(0.25)).toBe('\x1b[32m██░░░░░░░░\x1b[0m \x1b[90m20%\x1b[0m');
  });
});

describe('createProgress', () => {
  const tty = (columns?: number) => {
    const writes: string[] = [];
    return { writes, out: { isTTY: true, columns, write: (s: string) => void writes.push(s) } };
  };
  const frames = (writes: string[]) =>
    writes.filter((w) => w !== '\r\x1b[2K').map((w) => w.replace('\r\x1b[2K', ''));

  it('fills the intro under the ~1.5 s of a cached npx run', () => {
    expect(INTRO_CELLS).toBe(7);
    expect(FRAME_MS).toBe(150);
    expect(INTRO_CELLS * FRAME_MS).toBeLessThan(1500);
  });

  it('draws nothing until start, then an empty bar and one intro cell per frame', () => {
    vi.useFakeTimers();
    const { writes, out } = tty();
    const p = createProgress('Installing', out);
    p.update(0.5);
    expect(writes).toEqual([]);
    p.start();
    expect(frames(writes)).toEqual(['Installing ░░░░░░░░░░ 0%']);
    vi.advanceTimersByTime(FRAME_MS - 1);
    expect(frames(writes).length).toBe(1);
    vi.advanceTimersByTime(1);
    expect(frames(writes).at(-1)).toBe('Installing █░░░░░░░░░ 10%');
    vi.advanceTimersByTime(5 * FRAME_MS);
    expect(frames(writes).at(-1)).toBe('Installing ██████░░░░ 60%');
    vi.advanceTimersByTime(FRAME_MS);
    // 70% shows even though npx has already reported progress
    expect(frames(writes).at(-1)).toBe('Installing ███████░░░ 70%');
    vi.advanceTimersByTime(FRAME_MS - 1);
    expect(frames(writes).at(-1)).toBe('Installing ███████░░░ 70%');
    vi.advanceTimersByTime(1);
    // the intro is full, so the stored fraction shows in the cells after it
    expect(frames(writes).at(-1)).toBe('Installing ████████░░ 80%');
    vi.advanceTimersByTime(FRAME_MS);
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  it('keeps every progress value on screen for a whole frame', () => {
    vi.useFakeTimers();
    const { writes, out } = tty();
    const p = createProgress('Installing', out);
    p.start();
    vi.advanceTimersByTime(INTRO_CELLS * FRAME_MS);
    expect(frames(writes).at(-1)).toBe('Installing ███████░░░ 70%');
    vi.advanceTimersByTime(FRAME_MS);
    p.update(1 / 3);
    expect(frames(writes).at(-1)).toBe('Installing ████████░░ 80%');
    vi.advanceTimersByTime(10);
    // 90% arrives 10 ms after 80%, so it waits for the rest of the frame
    p.update(0.99);
    expect(frames(writes).at(-1)).toBe('Installing ████████░░ 80%');
    vi.advanceTimersByTime(FRAME_MS - 11);
    expect(frames(writes).at(-1)).toBe('Installing ████████░░ 80%');
    vi.advanceTimersByTime(1);
    expect(frames(writes).at(-1)).toBe('Installing █████████░ 90%');
    vi.useRealTimers();
  });

  it('maps the fraction onto the last three cells, never the tenth before done', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { writes, out } = tty();
    const p = createProgress('Installing', out);
    p.start();
    vi.advanceTimersByTime((INTRO_CELLS + 1) * FRAME_MS);
    p.update(1 / 3);
    vi.advanceTimersByTime(FRAME_MS);
    expect(frames(writes).at(-1)).toBe('Installing ████████░░ 80%');
    p.update(0.99);
    vi.advanceTimersByTime(FRAME_MS);
    expect(frames(writes).at(-1)).toBe('Installing █████████░ 90%');
    p.update(0.99);
    expect(writes.length).toBe(INTRO_CELLS + 3);
    const done = p.done('Installing 1 skill');
    // 90% has been on screen for a whole frame already, so the final line comes at once
    await done;
    expect(writes.at(-1)).toBe('\r\x1b[2K');
    expect(console.log).toHaveBeenCalledWith('Installing 1 skill ██████████ 100%');
    vi.useRealTimers();
  });

  it('holds the last frame for its whole time before the final line', async () => {
    vi.useFakeTimers();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { writes, out } = tty();
    const p = createProgress('Installing', out);
    p.start();
    vi.advanceTimersByTime(40);
    const done = p.done();
    await vi.advanceTimersByTimeAsync(FRAME_MS - 41);
    expect(log).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await done;
    expect(frames(writes)).toEqual(['Installing ░░░░░░░░░░ 0%']);
    expect(log).toHaveBeenCalledWith('Installing ██████████ 100%');
    vi.useRealTimers();
  });

  it('takes its own intro length and frame time, and tells when the intro is full', async () => {
    vi.useFakeTimers();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { writes, out } = tty();
    const p = createProgress('Symlinking', out, { introCells: 9, frameMs: 50 });
    p.start();
    let filled = false;
    void p.filled().then(() => {
      filled = true;
    });
    await vi.advanceTimersByTimeAsync(8 * 50);
    expect(frames(writes).at(-1)).toBe('Symlinking ████████░░ 80%');
    expect(filled).toBe(false);
    await vi.advanceTimersByTimeAsync(50);
    expect(frames(writes).at(-1)).toBe('Symlinking █████████░ 90%');
    expect(filled).toBe(true);
    const done = p.done();
    await vi.advanceTimersByTimeAsync(49);
    expect(log).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await done;
    expect(frames(writes).length).toBe(10);
    expect(log).toHaveBeenCalledWith('Symlinking ██████████ 100%');
    vi.useRealTimers();
  });

  it('is filled at once outside a TTY', async () => {
    const p = createProgress('Symlinking', { isTTY: false, write: () => {} });
    p.start();
    await p.filled();
  });

  it('prints only the final line outside a TTY', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const writes: string[] = [];
    const p = createProgress('Installing', { isTTY: false, write: (s) => void writes.push(s) });
    p.start();
    p.update(0.5);
    await p.done();
    expect(writes).toEqual([]);
    expect(log.mock.calls).toEqual([['Installing ██████████ 100%']]);
  });

  it('shortens the label so a frame fits one terminal row', () => {
    const { writes, out } = tty(40);
    const p = createProgress('Installing from /Users/someone/work/github/sentimony/skills', out);
    p.start();
    p.fail();
    // 40 columns - 1 spare - 16 for " ██████████ 100%" leaves 23 for the label
    expect(writes[0]).toBe('\r\x1b[2KInstalling from /Users… ░░░░░░░░░░ 0%');
    expect(writes[0]?.replace('\r\x1b[2K', '').length).toBeLessThan(40);
  });

  it('keeps the whole label in the final line', async () => {
    vi.useFakeTimers();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const p = createProgress('Installing from https://github.com/a/b', tty(20).out);
    p.start();
    const done = p.done();
    await vi.advanceTimersByTimeAsync(FRAME_MS);
    await done;
    vi.useRealTimers();
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
