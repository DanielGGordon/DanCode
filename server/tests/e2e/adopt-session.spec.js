import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const TMUX_SESSION_NAME = `e2e-orphan-${Date.now()}`;
const PROJECT_NAME = `Adopt E2E ${Date.now()}`;

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function login(page) {
  const tokenPath = join(homedir(), '.dancode', 'auth-token');
  const token = (await readFile(tokenPath, 'utf-8')).trim();

  await page.goto('/');
  const tokenInput = page.getByTestId('token-input');
  await expect(tokenInput).toBeVisible();
  await tokenInput.fill(token);
  await page.getByTestId('login-submit').click();

  await expect(page.getByTestId('new-project-button')).toBeVisible();

  return token;
}

test.describe('Adopt existing tmux session', () => {
  let slug;
  let token;

  test.beforeEach(async () => {
    // Create a tmux session manually before the test
    await execFileAsync('tmux', ['new-session', '-d', '-s', TMUX_SESSION_NAME]);
  });

  test.afterEach(async ({ request }) => {
    // Clean up: delete project config via API
    if (slug && token) {
      try {
        await request.delete(`/api/projects/${slug}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch {
        // best-effort cleanup
      }
    }

    // Clean up: kill the manually created tmux session
    try {
      await execFileAsync('tmux', ['kill-session', '-t', TMUX_SESSION_NAME]);
    } catch {
      // session may already be gone
    }
  });

  test('adopt a manually created tmux session and see its panes', async ({ page }) => {
    token = await login(page);
    slug = slugify(PROJECT_NAME);

    // Click the "New Project" button
    await page.getByTestId('new-project-button').click();

    // Form is visible
    const form = page.getByTestId('new-project-form');
    await expect(form).toBeVisible();

    // Fill in the project name
    await page.getByTestId('project-name-input').fill(PROJECT_NAME);

    // Toggle adopt mode — the orphan session should be available
    const toggle = page.getByTestId('adopt-session-toggle');
    await expect(toggle).toBeVisible();
    await expect(toggle).toBeEnabled();
    await toggle.click();

    // Session dropdown should appear
    const sessionSelect = page.getByTestId('adopt-session-select');
    await expect(sessionSelect).toBeVisible({ timeout: 5000 });

    // Select our manually created session
    await sessionSelect.selectOption(TMUX_SESSION_NAME);

    // Submit the form
    await page.getByTestId('new-project-submit').click();

    // After adoption, form disappears and pane layout appears
    await expect(form).not.toBeVisible({ timeout: 15000 });
    const paneLayout = page.getByTestId('pane-layout');
    await expect(paneLayout).toBeVisible({ timeout: 15000 });

    // The adopted session has one window by default — verify at least one pane is rendered
    const pane0 = page.getByTestId('pane-0');
    await expect(pane0).toBeVisible({ timeout: 10000 });

    // Verify xterm.js renders inside the pane
    const xtermElement = pane0.locator('.xterm');
    await expect(xtermElement).toBeVisible({ timeout: 10000 });
  });
});
