import { defineConfig } from '@playwright/test';

/**
 * Playwright config for shellhost-backed E2E tests (Phase 1+).
 *
 * Boots shellhost via globalSetup (UNIX-socket-based, can't be a webServer)
 * and then a server + client pointed at the temp socket. The server is started
 * with DANCODE_REQUIRE_SHELLHOST=1, which disables the legacy tmux fallback,
 * so the spec cannot silently regress to the tmux backend if the socket isn't
 * ready in time. The server polls the socket for up to 60s in this mode.
 *
 * Run with: `npm run test:e2e:shellhost`.
 */
const SHELLHOST_SOCKET = process.env.DANCODE_SHELLHOST_SOCKET
  || '/tmp/dancode-shellhost-e2e.sock';
const SERVER_PORT = Number(process.env.DANCODE_E2E_SERVER_PORT || 3002);
const CLIENT_PORT = Number(process.env.DANCODE_E2E_CLIENT_PORT || 5175);

export default defineConfig({
  testDir: './tests/e2e-shellhost',
  testIgnore: ['**/global-setup.js'],
  timeout: 600_000,
  retries: 0,
  reporter: 'list',
  globalSetup: './tests/e2e-shellhost/global-setup.js',
  globalTeardown: './tests/e2e-shellhost/global-teardown.js',
  use: {
    channel: 'chromium',
    baseURL: `http://localhost:${CLIENT_PORT}`,
  },
  webServer: [
    {
      command: `PORT=${SERVER_PORT} DANCODE_SHELLHOST_SOCKET=${SHELLHOST_SOCKET} DANCODE_REQUIRE_SHELLHOST=1 node src/index.js`,
      port: SERVER_PORT,
      reuseExistingServer: false,
      timeout: 90_000,
    },
    {
      command: `VITE_BACKEND_PORT=${SERVER_PORT} npx vite --port ${CLIENT_PORT}`,
      cwd: '../client',
      port: CLIENT_PORT,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
