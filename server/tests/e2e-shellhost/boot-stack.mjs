#!/usr/bin/env node
/**
 * Boots a dancode-shellhost and the dancode-server in a single parent process
 * so Playwright's `webServer` entry can wait on the server's TCP port.
 *
 * Playwright starts the `webServer` BEFORE running globalSetup, which means
 * a separately-launched shellhost (in globalSetup) doesn't exist yet when the
 * server's startup begins polling. Combining both into one process avoids
 * that ordering pitfall and gives us deterministic teardown via parent exit.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');
const SHELLHOST_ENTRY = join(REPO_ROOT, 'shellhost', 'src', 'index.js');

const socketPath = process.env.DANCODE_SHELLHOST_SOCKET
  || '/tmp/dancode-shellhost-e2e.sock';

if (existsSync(socketPath)) {
  try { await rm(socketPath); } catch { /* ignore */ }
}

const shellhostChild = spawn(process.execPath, [SHELLHOST_ENTRY], {
  env: { ...process.env, DANCODE_SHELLHOST_SOCKET: socketPath },
  stdio: ['ignore', 'pipe', 'pipe'],
});

shellhostChild.stdout.on('data', (b) => process.stdout.write(`[shellhost] ${b}`));
shellhostChild.stderr.on('data', (b) => process.stderr.write(`[shellhost stderr] ${b}`));

await new Promise((resolve, reject) => {
  const timer = setTimeout(
    () => reject(new Error('shellhost did not start within 15s')),
    15_000
  );
  const onStdout = (b) => {
    if (b.toString('utf8').includes('listening on')) {
      clearTimeout(timer);
      shellhostChild.stdout.off('data', onStdout);
      resolve();
    }
  };
  shellhostChild.stdout.on('data', onStdout);
  shellhostChild.once('exit', (code, signal) => {
    clearTimeout(timer);
    reject(new Error(`shellhost exited prematurely (code=${code} signal=${signal})`));
  });
});

process.env.DANCODE_SHELLHOST_SOCKET = socketPath;
process.env.DANCODE_REQUIRE_SHELLHOST = '1';

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  try { shellhostChild.kill(signal || 'SIGTERM'); } catch { /* ignore */ }
  shellhostChild.once('exit', () => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('exit', () => {
  try { shellhostChild.kill('SIGTERM'); } catch { /* ignore */ }
});

const SERVER_ENTRY = join(REPO_ROOT, 'server', 'src', 'index.js');
const serverMod = await import(SERVER_ENTRY);
const port = Number(process.env.PORT || 3001);
await serverMod.startServer(port);
