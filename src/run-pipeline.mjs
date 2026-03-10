import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    console.log(`> ${cmd} ${args.join(' ')}`);
    const p = spawn(cmd, args, { 
      stdio: 'inherit', 
      shell: true, 
      cwd: root 
    });
    p.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Command failed with code ${code}`));
    });
    p.on('error', reject);
  });
}

function startServer() {
  console.log('> Starting proxy server...');
  const server = spawn('node', ['src/proxy-server.mjs'], {
    stdio: 'pipe', // Pipe stdout/stderr so we can wait for "Server started"
    shell: false,  // Avoid shell wrapper to get direct PID
    cwd: root
  });
  
  server.stdout.on('data', (data) => {
    process.stdout.write(`[proxy] ${data}`);
  });
  server.stderr.on('data', (data) => {
    process.stderr.write(`[proxy] ${data}`);
  });

  return server;
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  let server;
  try {
    server = startServer();
    // Wait for server to initialize
    await sleep(3000);

    // 1. Crawl
    await run('node', ['src/crawler.mjs', '--proxy-endpoint', 'http://localhost:12345/proxy-request', '--limit', '0', '--overwrite']);

    // 2. Extract
    await run('node', ['src/extractor.mjs']);

    // 3. Build
    // Use full path to tsx or npx
    await run('npx', ['tsx', 'src/pack-builder.ts']);

    console.log('Pipeline completed successfully.');
  } catch (err) {
    console.error('Pipeline failed:', err);
    process.exitCode = 1;
  } finally {
    if (server) {
      console.log('Stopping proxy server...');
      server.kill();
    }
  }
}

main();
