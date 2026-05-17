import { defineConfig } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Playwright config for shellhost-backed E2E tests (Phase 1+).
 *
 * Playwright starts `webServer` entries BEFORE running `globalSetup`, so a
 * shellhost spawned in globalSetup wouldn't exist yet when the server begins
 * polling for its socket. Instead, the server's webServer entry runs
 * `boot-stack.mjs`, which boots shellhost as a child of the server process
 * and then loads the server inline. Parent exit cleans up the child.
 *
 * To keep the test deterministic and isolated from any real DanCode account
 * on the dev machine, every run uses a fresh temp HOME — auth, projects and
 * terminal metadata all live under it. The login helper creates a known
 * test account via /api/auth/setup on first request, since the temp HOME
 * has no credentials yet.
 *
 * The server always waits for `DANCODE_SHELLHOST_SOCKET` to come up at boot,
 * and boot-stack.mjs races a real shellhost into existence on that path.
 *
 * Run with: `npm run test:e2e:shellhost`.
 */
const SHELLHOST_SOCKET = process.env.DANCODE_SHELLHOST_SOCKET
  || '/tmp/dancode-shellhost-e2e.sock';
const SERVER_PORT = Number(process.env.DANCODE_E2E_SERVER_PORT || 3102);
const CLIENT_PORT = Number(process.env.DANCODE_E2E_CLIENT_PORT || 5175);

// Each playwright invocation gets its own temp HOME so account setup runs
// fresh and tests don't fight with a real ~/.dancode account.
const E2E_HOME = process.env.DANCODE_E2E_HOME
  || mkdtempSync(join(tmpdir(), 'dancode-e2e-home-'));
process.env.DANCODE_E2E_HOME = E2E_HOME;

export default defineConfig({
  testDir: './tests/e2e-shellhost',
  testIgnore: ['**/global-setup.js', '**/global-teardown.js', '**/boot-stack.mjs'],
  timeout: 600_000,
  retries: 0,
  reporter: 'list',
  // Account setup + temp-HOME credentials are not parallel-safe: parallel
  // workers race to POST /api/auth/setup and the loser can't read credentials
  // from the server's E2E_HOME. Run shellhost E2Es serially.
  workers: 1,
  fullyParallel: false,
  globalTeardown: './tests/e2e-shellhost/global-teardown.js',
  use: {
    channel: 'chromium',
    baseURL: `http://localhost:${CLIENT_PORT}`,
  },
  webServer: [
    {
      command: `PORT=${SERVER_PORT} HOME=${E2E_HOME} DANCODE_SHELLHOST_SOCKET=${SHELLHOST_SOCKET} DANCODE_REQUIRE_SHELLHOST=1 node tests/e2e-shellhost/boot-stack.mjs`,
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
