import { dirname } from 'node:path';
import {
  compareVersions,
  detectInstall,
  fetchLatest,
  type InstallKind,
  realOrSelf,
  writeCache,
} from '../utils/update-check';
import { defaultSpawn, type Spawner } from './add';

const PREFIX = 'skl update';
const NPX_LATEST = 'npx -y --prefer-online skl-x';

export function localCopyMessage(cliPath: string): string {
  return `skl-x runs from ${dirname(dirname(realOrSelf(cliPath)))}, not from a global npm install`;
}

export interface UpdateDeps {
  version: string;
  install?: () => InstallKind;
  latest?: () => Promise<string | undefined>;
  spawn?: Spawner;
  saveLatest?: (latest: string) => void;
  cliPath?: string;
}

export const UPDATE_HELP = [
  'Install the latest skl-x from npm globally (npm i -g skl-x@<latest>).',
  'Only a global npm install is updated: under npx nothing is installed, a local copy exits 1.',
  '',
  'USAGE skl-x update',
  '       skl-x up',
  '',
  'OPTIONS',
  '',
  '  -h, --help          Show this help and exit',
].join('\n');

export async function runUpdate(argv: string[], deps: UpdateDeps): Promise<number> {
  if (argv.includes('-h') || argv.includes('--help')) {
    console.log(UPDATE_HELP);
    return 0;
  }
  const extra = argv[0];
  if (extra !== undefined) {
    console.error(`${PREFIX}: unexpected argument ${extra}, use skl update -h for usage`);
    return 1;
  }
  const cliPath = deps.cliPath ?? process.argv[1] ?? '';
  const install = (deps.install ?? (() => detectInstall(cliPath)))();
  if (install === 'local') {
    console.error(`${PREFIX}: ${localCopyMessage(cliPath)}; update that copy by hand`);
    return 1;
  }
  const latest = await (deps.latest ?? fetchLatest)();
  if (install === 'npx') {
    // without --prefer-online npx may run an older copy from its cache
    console.log(
      latest && compareVersions(latest, deps.version) > 0
        ? `skl-x ${deps.version} runs through npx; the latest is ${latest}: ${NPX_LATEST}`
        : `skl-x ${deps.version} runs through npx, which takes the latest version: ${NPX_LATEST}`,
    );
    return 0;
  }
  if (!latest) {
    console.error(`${PREFIX}: could not get the latest version from registry.npmjs.org`);
    return 1;
  }
  const saveLatest =
    deps.saveLatest ?? ((v: string) => writeCache({ checkedAt: Date.now(), latest: v }));
  if (compareVersions(latest, deps.version) <= 0) {
    saveLatest(latest);
    console.log(`skl-x ${deps.version} is already the latest.`);
    return 0;
  }
  const args = ['i', '-g', `skl-x@${latest}`];
  console.log(`Updating skl-x via \`npm ${args.join(' ')}\`...`);
  console.log(`==> Updating skl-x from ${deps.version} to ${latest}`);
  const r = await (deps.spawn ?? defaultSpawn)('npm', args, false);
  if (r.status !== 0) {
    const reason = r.error ? r.error.message : `exit code ${r.status}`;
    console.error(`${PREFIX}: npm ${args.join(' ')} failed (${reason})`);
    return 1;
  }
  saveLatest(latest);
  console.log(`skl-x ${latest} installed successfully.`);
  return 0;
}
