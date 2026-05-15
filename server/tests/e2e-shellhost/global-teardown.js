import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';

/**
 * Cleans up after the shellhost E2E run: the temp HOME directory used for
 * isolating auth/projects/terminal state, and the shellhost UNIX socket if
 * Playwright didn't already remove it. Playwright manages the webServer
 * subprocess lifetime itself, so we don't need to kill anything here.
 */
export default async function globalTeardown() {
  const socketPath = process.env.DANCODE_SHELLHOST_SOCKET;
  if (socketPath && existsSync(socketPath)) {
    try { await rm(socketPath); } catch { /* ignore */ }
  }
  const home = process.env.DANCODE_E2E_HOME;
  if (home && home.includes('dancode-e2e-home-') && existsSync(home)) {
    try { await rm(home, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}
