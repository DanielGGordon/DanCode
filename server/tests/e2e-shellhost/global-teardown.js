import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';

/**
 * Mirror of global-setup.js: tear down the shellhost child process and its
 * temp socket. globalSetup tracks the child PID in `process.env.__SHELLHOST_PID`.
 */
export default async function globalTeardown() {
  const pidStr = process.env.__SHELLHOST_PID;
  const socketPath = process.env.DANCODE_SHELLHOST_SOCKET;
  if (pidStr) {
    const pid = Number(pidStr);
    try { process.kill(pid, 'SIGTERM'); } catch { /* not running */ }
  }
  if (socketPath && existsSync(socketPath)) {
    try { await rm(socketPath); } catch { /* ignore */ }
  }
}
