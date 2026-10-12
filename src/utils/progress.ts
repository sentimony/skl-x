import { gray, green } from './ansi';

const WIDTH = 10;
// cells filled on a timer once the bar starts; the rest follow the real progress
export const INTRO_CELLS = 7;
// every frame stays on screen at least this long, so no value flashes by: the intro moves one
// cell per frame, and a progress value that arrives sooner waits for the current frame
export const FRAME_MS = 150;

export interface ProgressOut {
  isTTY: boolean;
  columns?: number;
  write: (s: string) => void;
}

// green cells, gray percent
export function renderBar(fraction: number): string {
  const f = Math.min(1, Math.max(0, fraction));
  return renderCells(Math.floor(f * WIDTH));
}

function renderCells(cells: number): string {
  return `${green('█'.repeat(cells) + '░'.repeat(WIDTH - cells))} ${gray(`${cells * 10}%`)}`;
}

export interface Progress {
  // draws an empty bar and fills the intro cells one per frame; later calls do nothing
  start(): void;
  // share of the cells after the intro, 0..1; drawn once the intro is full
  update(fraction: number): void;
  // resolves once the intro cells are on screen, or at once outside a TTY
  filled(): Promise<void>;
  // resolves once the last frame has had its frame time and the final line is printed
  done(label?: string): Promise<void>;
  fail(): void;
}

const stdoutOut: ProgressOut = {
  get isTTY() {
    return Boolean(process.stdout.isTTY);
  },
  get columns() {
    return process.stdout.columns;
  },
  write: (s) => {
    process.stdout.write(s);
  },
};

// widest bar text: " ██████████ 100%"
const BAR_WIDTH = WIDTH + 6;

// `\x1b[2K` clears only the cursor's physical row, so a wrapped frame would leave its first row behind
function fitLabel(label: string, columns: number | undefined): string {
  if (!columns) return label;
  const max = columns - 1 - BAR_WIDTH;
  if (label.length <= max) return label;
  return max > 1 ? `${label.slice(0, max - 1)}…` : '';
}

// Frames only in a TTY; scripts and CI get just the final line from console.log
export function createProgress(
  label: string,
  out: ProgressOut = stdoutOut,
  { introCells = INTRO_CELLS, frameMs = FRAME_MS } = {},
): Progress {
  let started = false;
  let onFilled: (() => void) | null = null;
  let intro = 0;
  let fraction = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let last = '';
  let shownAt = 0;
  const schedule = (ms: number) => {
    timer = setTimeout(step, ms);
    // a pending frame must not keep the process alive, unless filled() is waiting for it
    if (!onFilled) timer.unref?.();
  };
  const draw = () => {
    const rest = WIDTH - introCells;
    // intro runs one past introCells, so its last cell gets its own frame even when progress is ahead
    const cells =
      intro <= introCells
        ? intro
        : introCells + Math.min(rest, Math.floor(Math.max(0, fraction) * rest));
    const frame = `\r\x1b[2K${gray(fitLabel(label, out.columns))} ${renderCells(cells)}`;
    if (frame === last) return;
    out.write(frame);
    last = frame;
    shownAt = Date.now();
    if (intro >= introCells && onFilled) {
      onFilled();
      onFilled = null;
    }
    // the next intro cell, or a progress value that arrives before this frame's time is up
    schedule(frameMs);
  };
  function step() {
    timer = null;
    const wait = shownAt + frameMs - Date.now();
    if (wait > 0) return schedule(wait);
    if (intro <= introCells) intro++;
    draw();
  }
  const stop = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  return {
    start() {
      if (!out.isTTY || started) return;
      started = true;
      draw();
    },
    update(f) {
      fraction = f;
      // a pending timer draws the new value when the current frame's time is up
      if (started && !timer) step();
    },
    filled() {
      if (!started || intro >= introCells) return Promise.resolve();
      return new Promise<void>((resolve) => {
        onFilled = resolve;
        timer?.ref?.();
      });
    },
    async done(final = label) {
      stop();
      if (last) {
        // the last value gets its full frame before the final line replaces it
        const wait = shownAt + frameMs - Date.now();
        if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
        out.write('\r\x1b[2K');
      }
      console.log(`${gray(final)} ${renderBar(1)}`);
    },
    fail() {
      stop();
      if (last) out.write('\n');
      else console.log(gray(label));
    },
  };
}
