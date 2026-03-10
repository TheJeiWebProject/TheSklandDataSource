import type { BuildArgs } from './types.ts';

export const DEFAULTS: BuildArgs = {
  infoRoot: 'temp/info',
  methodsRoot: 'temp/skland-methods',
  outDir: 'dist',
  packId: 'skland',
  gameId: 'skland',
  displayName: 'Skland Wiki Pack',
  version: '',
  imageMode: 'origin',
  imageConfig: '',
  downloadAssets: false,
  assetConcurrency: 8,
  assetTimeoutMs: 20000,
  registerPackIndex: false,
};

export function parseArgs(argv: string[]): BuildArgs {
  const args: BuildArgs = { ...DEFAULTS };
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    const next = argv[i + 1];
    if ((key === '--help' || key === '-h') && !next) {
      args.help = true;
      continue;
    }
    if (key === '--info-root' && next) {
      args.infoRoot = next;
      i += 1;
      continue;
    }
    if (key === '--methods-root' && next) {
      args.methodsRoot = next;
      i += 1;
      continue;
    }
    if (key === '--out-dir' && next) {
      args.outDir = next;
      i += 1;
      continue;
    }
    if (key === '--pack-id' && next) {
      args.packId = next;
      i += 1;
      continue;
    }
    if (key === '--game-id' && next) {
      args.gameId = next;
      i += 1;
      continue;
    }
    if (key === '--display-name' && next) {
      args.displayName = next;
      i += 1;
      continue;
    }
    if (key === '--version' && next) {
      args.version = next;
      i += 1;
      continue;
    }
    if (key === '--image-mode' && next) {
      const mode = String(next).trim().toLowerCase();
      if (mode === 'origin' || mode === 'proxy' || mode === 'dev') {
        args.imageMode = mode;
      }
      i += 1;
      continue;
    }
    if (key === '--image-config' && next) {
      args.imageConfig = next;
      i += 1;
      continue;
    }
    if (key === '--download-assets') {
      args.downloadAssets = true;
      continue;
    }
    if (key === '--asset-concurrency' && next) {
      args.assetConcurrency = Math.max(1, Number.parseInt(next, 10) || DEFAULTS.assetConcurrency);
      i += 1;
      continue;
    }
    if (key === '--asset-timeout-ms' && next) {
      args.assetTimeoutMs = Math.max(1000, Number.parseInt(next, 10) || DEFAULTS.assetTimeoutMs);
      i += 1;
      continue;
    }
    if (key === '--register-pack-index') {
      args.registerPackIndex = true;
      continue;
    }
  }
  return args;
}

export function printHelp(): void {
  console.log(`Generate JEI-web pack from Skland wiki data

Usage:
  node scripts/generate-skland-pack.mjs [options]

Options:
  --info-root <path>          Skland info root (default: temp/info)
  --methods-root <path>       Extracted methods root (default: temp/skland-methods)
  --out-dir <path>            Output pack dir (default: public/packs/skland)
  --pack-id <id>              Pack id (default: skland)
  --game-id <id>              Game id (default: skland)
  --display-name <name>       Pack display name
  --version <text>            Pack version text
  --image-mode <origin|proxy|dev> Image URL strategy (default: origin)
  --image-config <path>       JSON config for proxy base/tokens/headers/urlTemplate
  --download-assets           Download wiki image assets to local pack assets/images
  --asset-concurrency <n>     Parallel image downloads (default: 8)
  --asset-timeout-ms <ms>     Single image timeout (default: 20000)
  --register-pack-index       Append/update public/packs/index.json entry

Examples:
  node scripts/generate-skland-pack.mjs --info-root D:\\data\\skland\\info --methods-root D:\\data\\skland\\converted-methods --out-dir D:\\data\\skland\\jei-pack --image-mode dev --image-config ./scripts/skland-pack/image-source.config.json
  node scripts/generate-skland-pack.mjs --info-root temp/info --methods-root temp/skland-methods --out-dir public/packs/skland --register-pack-index
`);
}
