// sm: one summary line; md: progress line, table, summary; lg: md plus details (e.g. the npx output)
export type OutputMode = 'sm' | 'md' | 'lg';

export type ModeResult =
  | { kind: 'ok'; mode: OutputMode; rest: string[] }
  | { kind: 'error'; message: string };

const VALUES = new Map<string, OutputMode>([
  ['sm', 'sm'],
  ['small', 'sm'],
  ['md', 'md'],
  ['medium', 'md'],
  ['lg', 'lg'],
  ['large', 'lg'],
]);

// the 0.4.6 names; s is not an alias of sm, it was the md output
const REMOVED = new Map<string, OutputMode>([
  ['quiet', 'sm'],
  ['q', 'sm'],
  ['silent', 'md'],
  ['s', 'md'],
  ['clear', 'lg'],
  ['c', 'lg'],
]);

const CHOICES = 'sm (small), md (medium) or lg (large)';

export function extractMode(argv: string[]): ModeResult {
  const rest: string[] = [];
  let chosen: OutputMode | null = null;
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i] ?? '';
    let value: string | undefined;
    if (tok === '-m' || tok === '--mode') {
      value = argv[i + 1];
      if (value === undefined || value.startsWith('-')) {
        return { kind: 'error', message: `${tok} needs a value: ${CHOICES}` };
      }
      i++;
    } else if (tok.startsWith('--mode=')) {
      value = tok.slice('--mode='.length);
    } else {
      rest.push(tok);
      continue;
    }
    const mode = VALUES.get(value);
    const renamed = REMOVED.get(value);
    if (renamed !== undefined) {
      return { kind: 'error', message: `mode "${value}" was renamed in 0.4.8, use ${renamed}` };
    }
    if (mode === undefined) {
      return { kind: 'error', message: `unknown mode "${value}", use ${CHOICES}` };
    }
    if (chosen !== null && chosen !== mode) {
      return { kind: 'error', message: `conflicting modes: ${chosen} and ${mode}` };
    }
    chosen = mode;
  }
  return { kind: 'ok', mode: chosen ?? 'lg', rest };
}
