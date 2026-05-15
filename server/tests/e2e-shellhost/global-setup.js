/**
 * Boots a dedicated dancode-shellhost on a temp socket before Playwright runs,
 * stashes the child PID + socket path on `process.env` so the webServer commands
 * (and the test specs themselves, if needed) can read them, and kills the child
 * cleanly during teardown.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHELLHOST_ENTRY = join(__dirname, '..', '..', '..', 'shellhost', 'src', 'index.js');

let child = null;

export default async function globalSetup() {
  const socketPath = process.env.DANCODE_SHELLHOST_SOCKET
    || '/tmp/dancode-shellhost-e2e.sock';

  if (existsSync(socketPath)) {
    try { await rm(socketPath); } catch { /* ignore */ }
  }

  child = spawn(process.execPath, [SHELLHOST_ENTRY], {
    env: { ...process.env, DANCODE_SHELLHOST_SOCKET: socketPath },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });

  // Wait for the "listening on" line.
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('shellhost did not start within 10s')), 10_000);
    child.stdout.on('data', (b) => {
      const s = b.toString('utf8');
      if (s.includes('listening on')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.stderr.on('data', (b) => process.stderr.write(`[shellhost stderr] ${b}`));
    child.once('exit', (code, signal) => {
      reject(new Error(`shellhost exited prematurely (code=${code} signal=${signal})`));
    });
  });

  process.env.__SHELLHOST_PID = String(child.pid);
  process.env.DANCODE_SHELLHOST_SOCKET = socketPath;
}

export async function globalTeardown() {
  if (!child) return;
  try { child.kill('SIGTERM'); } catch { /* ignore */ }
  await new Promise((r) => child.once('exit', r));
}
