import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

test('xterm.js terminal element is visible', async ({ page }) => {
  const tokenPath = join(homedir(), '.dancode', 'auth-token');
  const token = (await readFile(tokenPath, 'utf-8')).trim();

  await page.goto('/');

  // Login first
  const tokenInput = page.getByTestId('token-input');
  await expect(tokenInput).toBeVisible();
  await tokenInput.fill(token);
  await page.getByTestId('login-submit').click();

  // Wait for the terminal container (React component) to be visible
  const terminal = page.getByTestId('terminal');
  await expect(terminal).toBeVisible();

  // Wait for xterm.js to render its canvas inside the container
  const xtermElement = terminal.locator('.xterm');
  await expect(xtermElement).toBeVisible();
});
