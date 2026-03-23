import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { rm } from 'node:fs/promises';

const execFileAsync = promisify(execFile);

const PROJECT_NAME = `E2E Test ${Date.now()}`;

async function login(page) {
  const tokenPath = join(homedir(), '.dancode', 'auth-token');
  const token = (await readFile(tokenPath, 'utf-8')).trim();

  await page.goto('/');
  const tokenInput = page.getByTestId('token-input');
  await expect(tokenInput).toBeVisible();
  await tokenInput.fill(token);
  await page.getByTestId('login-submit').click();

  // Wait for authenticated view (terminal or header)
  await expect(page.getByTestId('new-project-button')).toBeVisible();

  return token;
}

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

test.describe('New Project flow', () => {
  let slug;
  let token;

  test.afterEach(async ({ request }) => {
    if (!slug || !token) return;

    // Clean up: delete project config via API
    try {
      await request.delete(`/api/projects/${slug}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      // best-effort cleanup
    }

    // Clean up: kill tmux session
    try {
      await execFileAsync('tmux', ['kill-session', '-t', `dancode-${slug}`]);
    } catch {
      // session may not exist
    }
  });

  test('click New Project, fill form, submit, see terminal panes', async ({ page }) => {
    token = await login(page);
    slug = slugify(PROJECT_NAME);

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
    // Use /tmp so we don't pollute the home directory
    const projectPath = `/tmp/dancode-e2e-${Date.now()}`;
    await pathInput.clear();
    await pathInput.fill(projectPath);

    // Submit the form
    await page.getByTestId('new-project-submit').click();

    // After creation, the form disappears and the new project's pane layout appears
    await expect(form).not.toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('pane-layout')).toBeVisible({ timeout: 15000 });

    // Verify the first pane's terminal is connected to the newly created project's session
    const terminal = page.getByTestId('pane-0').getByTestId('terminal');
    await expect(terminal).toBeVisible({ timeout: 15000 });
    await expect(terminal).toHaveAttribute('data-slug', slug);

    // xterm.js renders inside the terminal container
    const xtermElement = terminal.locator('.xterm');
    await expect(xtermElement).toBeVisible({ timeout: 10000 });

    // Clean up the temp project directory
    try {
      await rm(projectPath, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  });
});
