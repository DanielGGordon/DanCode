import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 600_000,
  retries: 0,
  reporter: 'list',
  use: {
    channel: 'chromium',
  },
  projects: [
    {
      name: 'backend',
      use: { baseURL: 'http://localhost:3001' },
      testMatch: /placeholder\.spec|(?:^|\/)visual\.spec/,
    },
    {
      name: 'frontend',
      use: { baseURL: 'http://localhost:5174' },
      testMatch: /terminal(?:-visual)?\.spec/,
    },
  ],
  webServer: [
    {
      command: 'PORT=3001 node src/index.js',
      port: 3001,
      reuseExistingServer: false,
    },
    {
      command: 'VITE_BACKEND_PORT=3001 npx vite --port 5174',
      cwd: '../client',
      port: 5174,
      reuseExistingServer: false,
    },
  ],
});
