import { test, expect } from '@playwright/test';
import { login, cleanupProject, slugify } from './e2e-helpers.js';
import { rm } from 'node:fs/promises';

const PROJECT_NAME = `E2E Test ${Date.now()}`;

test.describe('New Project flow', () => {
  let slug;
  let token;
  let projectPath;

  test.afterEach(async ({ request }) => {
    await cleanupProject(request, slug, token, projectPath);
  });

  test('click New Project, fill form, submit, see terminal layout', async ({ page }) => {
    token = await login(page);
    slug = slugify(PROJECT_NAME);
    projectPath = `/tmp/dancode-e2e-${Date.now()}`;

    // Click the "New Project" button
    await page.getByTestId('new-project-button').click();

    // Form is visible
    const form = page.getByTestId('new-project-form');
    await expect(form).toBeVisible();

    // Fill in name and path
    const nameInput = page.getByTestId('project-name-input');
    const pathInput = page.getByTestId('project-path-input');
    await expect(nameInput).toBeVisible();
    await expect(pathInput).toBeVisible();

    await nameInput.fill(PROJECT_NAME);
    await pathInput.clear();
    await pathInput.fill(projectPath);

    // Submit the form
    await page.getByTestId('new-project-submit').click();

    // After creation, the form disappears and the terminal layout appears
    await expect(form).not.toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('terminal-layout')).toBeVisible({ timeout: 15000 });

    // Verify the first pane's terminal is rendered
    const terminalPane = page.getByTestId('terminal-pane-0');
    await expect(terminalPane).toBeVisible({ timeout: 15000 });

    const terminal = terminalPane.getByTestId('terminal');
    await expect(terminal).toBeVisible({ timeout: 10000 });

    // xterm.js renders inside the terminal container
    const xtermElement = terminal.locator('.xterm');
    await expect(xtermElement).toBeVisible({ timeout: 10000 });
  });
});
