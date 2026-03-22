import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: 'http://localhost:3001',
    channel: undefined,
    launchOptions: {
      executablePath: '/usr/bin/chromium',
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
  webServer: {
    command: 'PORT=3001 node src/index.js',
    port: 3001,
    reuseExistingServer: false,
  },
});
