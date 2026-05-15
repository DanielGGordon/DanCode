import { defineConfig } from '@playwright/test';

/**
 * Playwright config for shellhost-backed E2E tests (Phase 1+).
 *
 * Boots shellhost via globalSetup (UNIX-socket-based, can't be a webServer)
 * and then a server + client pointed at the temp socket.
 *
 * Run with: `npm run test:e2e:shellhost`.
 */
const SHELLHOST_SOCKET = '/tmp/dancode-shellhost-e2e.sock';

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
    baseURL: 'http://localhost:5175',
  },
  webServer: [
    {
      command: `PORT=3002 DANCODE_SHELLHOST_SOCKET=${SHELLHOST_SOCKET} node src/index.js`,
      port: 3002,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: 'VITE_BACKEND_PORT=3002 npx vite --port 5175',
      cwd: '../client',
      port: 5175,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
});
