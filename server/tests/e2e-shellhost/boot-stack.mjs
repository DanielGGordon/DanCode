#!/usr/bin/env node
/**
 * Boots dancode-shellhost + a supervised dancode-server child process so the
 * Phase 3 restart E2E can kill the server (via /api/test-only/kill-server)
 * and observe the new server pick up the running PTYs.
 *
 * Playwright starts the `webServer` BEFORE running globalSetup, which means
 * a separately-launched shellhost (in globalSetup) doesn't exist yet when the
 * server begins polling. We boot both inside this parent process and parent
 * exit cleans up the children.
 *
 * The server is run as a child process (not inline) so that:
 *   - process.exit(0) from inside the server only kills the SERVER, not the
 *     supervising parent; we respawn it.
 *   - port 3xxx becomes free for the new server in milliseconds.
 *
 * Playwright's webServer polls the parent's port via a small bootstrap HTTP
 * server on that port — but `Express` can't bind a port that the server child
 * is also using. Instead, the parent runs the server child directly on the
 * Playwright port (no proxy) and we tolerate brief downtime during restart;
 * the browser's Socket.IO reconnects automatically.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');
const SHELLHOST_ENTRY = join(REPO_ROOT, 'shellhost', 'src', 'index.js');
const SERVER_ENTRY = join(REPO_ROOT, 'server', 'src', 'index.js');

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

let serverChild = null;
let shuttingDown = false;
let respawning = false;

function spawnServer() {
  const child = spawn(process.execPath, [SERVER_ENTRY], {
    env: {
      ...process.env,
      DANCODE_SHELLHOST_SOCKET: socketPath,
      DANCODE_REQUIRE_SHELLHOST: '1',
      NODE_ENV: 'test',
      PORT: process.env.PORT || '3001',
      // Forward HOME explicitly so the server uses our temp DanCode home.
      HOME: process.env.HOME,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (b) => process.stdout.write(`[server] ${b}`));
  child.stderr.on('data', (b) => process.stderr.write(`[server stderr] ${b}`));
  child.once('exit', (code, signal) => {
    if (shuttingDown) return;
    console.log(`[supervisor] server exited (code=${code} signal=${signal}); respawning`);
    respawning = true;
    serverChild = spawnServer();
    respawning = false;
  });
  return child;
}

serverChild = spawnServer();

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  try { serverChild?.kill(signal || 'SIGTERM'); } catch { /* ignore */ }
  try { shellhostChild.kill(signal || 'SIGTERM'); } catch { /* ignore */ }
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('exit', () => {
  try { serverChild?.kill('SIGTERM'); } catch { /* ignore */ }
  try { shellhostChild.kill('SIGTERM'); } catch { /* ignore */ }
});

// Keep the parent process alive — Node would otherwise exit because all our
// awaited setup work has finished. Stdin .resume() pins the event loop.
process.stdin.resume?.();
