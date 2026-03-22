import { test, expect } from './fixture.js';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

async function login(page) {
  const tokenPath = join(homedir(), '.dancode', 'auth-token');
  const token = (await readFile(tokenPath, 'utf-8')).trim();

  await page.goto('/');
  const tokenInput = page.getByTestId('token-input');
  await expect(tokenInput).toBeVisible();
  await tokenInput.fill(token);
  await page.getByTestId('login-submit').click();

  await expect(page.getByTestId('new-project-button')).toBeVisible();
}

test('new project form passes visual assertion', async ({ page, aiAssert }) => {
  await login(page);

  // Click "New Project" to show the form
  await page.getByTestId('new-project-button').click();
  await expect(page.getByTestId('new-project-form')).toBeVisible();

  await aiAssert('a new project form is displayed with name and path input fields on a dark background', undefined, {
    domIncluded: true,
    screenshotIncluded: true,
  });
});
