import { rmdirSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { createConfirmer } from '../utils/confirm';
import { detectInstall, getCachePath, type InstallKind } from '../utils/update-check';
import { defaultSpawn, type Spawner } from './add';
import { localCopyMessage } from './update';

const PREFIX = 'skl uninstall';

export interface UninstallDeps {
  version: string;
  install?: () => InstallKind;
  spawn?: Spawner;
  confirm?: (question: string) => Promise<boolean>;
  removeCache?: () => void;
  cliPath?: string;
}

export const UNINSTALL_HELP = [
  'Remove the global skl-x (npm uninstall -g skl-x) and its update-check cache.',
  'Skills stay: skl-x rm removes skills. Under npx nothing is removed, a local copy exits 1.',
  '',
  'USAGE skl-x uninstall [-y]',
  '',
  'OPTIONS',
  '',
  '  -y, --yes           Remove without asking',
  '  -h, --help          Show this help and exit',
].join('\n');

function removeCache(): void {
  const path = getCachePath();
  rmSync(path, { force: true });
  try {
    rmdirSync(dirname(path));
  } catch {
    // not empty or already gone
  }
}

export async function runUninstall(argv: string[], deps: UninstallDeps): Promise<number> {
  if (argv.includes('-h') || argv.includes('--help')) {
    console.log(UNINSTALL_HELP);
    return 0;
  }
  const extra = argv.find((a) => a !== '-y' && a !== '--yes');
  if (extra !== undefined) {
    console.error(`${PREFIX}: unexpected argument ${extra}, use skl uninstall -h for usage`);
    return 1;
  }
  const cliPath = deps.cliPath ?? process.argv[1] ?? '';
  const install = (deps.install ?? (() => detectInstall(cliPath)))();
  if (install === 'npx') {
    console.log(`skl-x ${deps.version} runs through npx: there is no global install to remove`);
    return 0;
  }
  if (install === 'local') {
    console.error(`${PREFIX}: ${localCopyMessage(cliPath)}; remove that copy by hand`);
    return 1;
  }
  if (argv.length === 0) {
    const ok = await (deps.confirm ?? createConfirmer())(
      `Remove skl-x ${deps.version} from the global npm install?`,
    );
    if (!ok) {
      console.log('Aborted');
      return 1;
    }
  }
  const args = ['uninstall', '-g', 'skl-x'];
  console.log(`==> Removing skl-x ${deps.version}`);
  const r = await (deps.spawn ?? defaultSpawn)('npm', args, false);
  if (r.status !== 0) {
    const reason = r.error ? r.error.message : `exit code ${r.status}`;
    console.error(`${PREFIX}: npm ${args.join(' ')} failed (${reason})`);
    return 1;
  }
  (deps.removeCache ?? removeCache)();
  console.log(`skl-x ${deps.version} removed.`);
  console.log(
    'A completion script added with skl completion stays in your shell rc file: remove it by hand.',
  );
  return 0;
}
