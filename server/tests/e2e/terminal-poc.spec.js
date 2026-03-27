import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { generate } from 'otplib';

const BACKEND_URL = 'http://localhost:3001';
const FRONTEND_URL = 'http://localhost:5174';
const CRED_PATH = join(homedir(), '.dancode', 'credentials.json');

let authToken;

async function getAuthToken() {
  const statusRes = await fetch(`${BACKEND_URL}/api/auth/setup/status`);
  const { setupComplete } = await statusRes.json();

  let totpSecret;
  let username;

  if (!setupComplete) {
    const setupRes = await fetch(`${BACKEND_URL}/api/auth/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'testuser', password: 'testpassword123' }),
    });
    const data = await setupRes.json();
    totpSecret = data.totpSecret;
    username = 'testuser';
  } else {
    const creds = JSON.parse(await readFile(CRED_PATH, 'utf-8'));
    totpSecret = creds.totpSecret;
    username = creds.username;
  }

  // Read password from env or file
  let password = process.env.DANCODE_PASSWORD;
  if (!password) {
    try {
      password = (await readFile(join(homedir(), '.dancode', 'e2e-password'), 'utf-8')).trim();
    } catch {
      password = 'testpassword123';
    }
  }

  const totpCode = await generate({ secret: totpSecret });
  const loginRes = await fetch(`${BACKEND_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, totpCode }),
  });

  if (!loginRes.ok) {
    throw new Error(`Login failed with status ${loginRes.status}`);
  }

  const { token } = await loginRes.json();
  return token;
}

test.beforeAll(async () => {
  authToken = await getAuthToken();
});

test('create terminal via API, type echo hello in xterm, see hello in output', async ({ page }) => {
  // Create a terminal via API
  const createRes = await fetch(`${BACKEND_URL}/api/terminals`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify({ projectSlug: 'e2e-test', label: 'E2E Terminal' }),
  });
  expect(createRes.status).toBe(201);
  const terminal = await createRes.json();

  try {
    // Navigate to the POC page
    await page.goto(`${FRONTEND_URL}/poc-terminal.html?id=${terminal.id}&token=${authToken}`);

    // Wait for WebSocket connection
    await expect(page).toHaveTitle(/Connected/, { timeout: 15000 });

    // Wait for shell prompt to appear
    await page.waitForTimeout(2000);

    // Click on the terminal to focus it
    await page.click('#terminal');
    await page.waitForTimeout(300);

    // Type the command
    await page.keyboard.type('echo hello', { delay: 50 });
    await page.keyboard.press('Enter');

    // Wait for "hello" to appear in the terminal buffer
    await expect(async () => {
      const text = await page.evaluate(() => {
        const term = window.term;
        if (!term) return '';
        const lines = [];
        for (let i = 0; i < term.buffer.active.length; i++) {
          const line = term.buffer.active.getLine(i);
          if (line) lines.push(line.translateToString().trim());
        }
        return lines.join('\n');
      });
      expect(text).toContain('hello');
    }).toPass({ timeout: 10000 });
  } finally {
    // Cleanup: delete the terminal
    await fetch(`${BACKEND_URL}/api/terminals/${terminal.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${authToken}` },
    });
  }
});
