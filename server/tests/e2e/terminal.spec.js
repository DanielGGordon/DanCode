import { test, expect } from '@playwright/test';

test('xterm.js terminal element is visible', async ({ page }) => {
  await page.goto('http://localhost:5174/');

  // Wait for the terminal container (React component) to be visible
  const terminal = page.getByTestId('terminal');
  await expect(terminal).toBeVisible();

  // Wait for xterm.js to render its canvas inside the container
  const xtermElement = terminal.locator('.xterm');
  await expect(xtermElement).toBeVisible();
});
