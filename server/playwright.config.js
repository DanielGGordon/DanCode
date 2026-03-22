import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 120_000,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3001',
    channel: 'chromium',
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
