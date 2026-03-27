import { test, expect } from '@playwright/test';
import { login, createProject, cleanupProject, slugify } from './e2e-helpers.js';

const PROJECT_NAME = `Terminal E2E ${Date.now()}`;

test('xterm.js terminal element is visible after creating a project', async ({ page, request }) => {
  const token = await login(page);
  const { slug, projectPath } = await createProject(page, PROJECT_NAME);

  try {
    // Wait for the terminal container (React component) to be visible
    const terminal = page.getByTestId('terminal');
    await expect(terminal.first()).toBeVisible({ timeout: 10000 });

    // Wait for xterm.js to render its canvas inside the container
    const xtermElement = terminal.first().locator('.xterm');
    await expect(xtermElement).toBeVisible({ timeout: 10000 });
  } finally {
    await cleanupProject(request, slug, token, projectPath);
  }
});
