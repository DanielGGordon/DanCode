import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

test('login flow: shows login screen, enter token, terminal appears', async ({ page }) => {
  const tokenPath = join(homedir(), '.dancode', 'auth-token');
  const token = (await readFile(tokenPath, 'utf-8')).trim();

  await page.goto('/');

  // Login screen is visible
  const tokenInput = page.getByTestId('token-input');
  await expect(tokenInput).toBeVisible();
  const submitButton = page.getByTestId('login-submit');
  await expect(submitButton).toBeVisible();
  await expect(page.getByText('Enter your auth token to continue')).toBeVisible();

  // Enter the token and submit
  await tokenInput.fill(token);
  await submitButton.click();

  // Terminal appears after login
  const terminal = page.getByTestId('terminal');
  await expect(terminal).toBeVisible();
  const xtermElement = terminal.locator('.xterm');
  await expect(xtermElement).toBeVisible();
});

test('invalid token shows error message', async ({ page }) => {
  await page.goto('/');

  const tokenInput = page.getByTestId('token-input');
  await expect(tokenInput).toBeVisible();

  // Enter an invalid token
  await tokenInput.fill('bad-token-value');
  await page.getByTestId('login-submit').click();

  // Error message appears, still on login screen
  await expect(page.getByTestId('login-error')).toHaveText('Invalid token');
  await expect(tokenInput).toBeVisible();
});
