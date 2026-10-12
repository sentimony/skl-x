import { green } from './ansi';

const WIDTH = 10;
// cells filled on a timer once the bar starts; the rest follow the real progress
export const INTRO_CELLS = 7;
export const INTRO_STEP_MS = 150;

export interface ProgressOut {
  isTTY: boolean;
  columns?: number;
  write: (s: string) => void;
}

// green cells, plain percent
export function renderBar(fraction: number): string {
  const f = Math.min(1, Math.max(0, fraction));
  return renderCells(Math.floor(f * WIDTH));
}

function renderCells(cells: number): string {
  return `${green('█'.repeat(cells) + '░'.repeat(WIDTH - cells))} ${cells * 10}%`;
}

export interface Progress {
  // draws the bar and fills the intro cells, one per INTRO_STEP_MS; later calls do nothing
  start(): void;
  // share of the cells after the intro, 0..1; drawn once the intro is full
  update(fraction: number): void;
  done(label?: string): void;
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
export function createProgress(label: string, out: ProgressOut = stdoutOut): Progress {
  let intro = 0;
  let fraction = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  let last = '';
  const draw = () => {
    const rest = WIDTH - INTRO_CELLS;
    const cells =
      intro < INTRO_CELLS
        ? intro
        : INTRO_CELLS + Math.min(rest, Math.floor(Math.max(0, fraction) * rest));
    const frame = `\r\x1b[2K${fitLabel(label, out.columns)} ${renderCells(cells)}`;
    if (frame === last) return;
    out.write(frame);
    last = frame;
  };
  const stop = () => {
    if (timer) clearInterval(timer);
    timer = null;
  };
  return {
    start() {
      if (!out.isTTY || intro > 0) return;
      intro = 1;
      draw();
      timer = setInterval(() => {
        intro++;
        if (intro >= INTRO_CELLS) stop();
        draw();
      }, INTRO_STEP_MS);
      // a pending frame must not keep the process alive
      timer.unref?.();
    },
    update(f) {
      fraction = f;
      if (intro > 0) draw();
    },
    done(final = label) {
      stop();
      if (last) out.write('\r\x1b[2K');
      console.log(`${final} ${renderBar(1)}`);
    },
    fail() {
      stop();
      if (last) out.write('\n');
      else console.log(label);
    },
  };
}
