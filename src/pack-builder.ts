import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, printHelp } from './lib/cli.ts';
import { buildSklandPack } from './lib/build.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }
  await buildSklandPack(args, repoRoot);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
