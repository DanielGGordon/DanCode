import { test, expect } from '@playwright/test';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const PROJECT_NAME = `Layout E2E ${Date.now()}`;

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

async function createProject(page, token) {
  const slug = slugify(PROJECT_NAME);
  const projectPath = `/tmp/dancode-layout-e2e-${Date.now()}`;

  await page.getByTestId('new-project-button').click();
  const form = page.getByTestId('new-project-form');
  await expect(form).toBeVisible();

  await page.getByTestId('project-name-input').fill(PROJECT_NAME);
  const pathInput = page.getByTestId('project-path-input');
  await pathInput.clear();
  await pathInput.fill(projectPath);
  await page.getByTestId('new-project-submit').click();

  // Wait for PaneLayout to appear
  await expect(page.getByTestId('pane-layout')).toBeVisible({ timeout: 15000 });

  return { slug, projectPath };
}

test.describe('Multi-pane layout', () => {
  let slug;
  let token;
  let projectPath;

  test.afterEach(async ({ request }) => {
    if (!slug || !token) return;

    try {
      await request.delete(`/api/projects/${slug}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch { /* best-effort */ }

    try {
      await execFileAsync('tmux', ['kill-session', '-t', `dancode-${slug}`]);
    } catch { /* session may not exist */ }

    if (projectPath) {
      try {
        await rm(projectPath, { recursive: true, force: true });
      } catch { /* best-effort */ }
    }
  });

  test('desktop viewport shows split layout with panes side by side', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    token = await login(page);
    ({ slug, projectPath } = await createProject(page, token));

    // Split mode: no tab bar, layout toggle visible
    await expect(page.getByTestId('tab-bar')).not.toBeVisible();
    await expect(page.getByTestId('layout-toggle')).toBeVisible();

    // Both panes are visible (CLI + Claude)
    await expect(page.getByTestId('pane-0')).toBeVisible();
    await expect(page.getByTestId('pane-1')).toBeVisible();

    // No tabbed-content container in split mode
    await expect(page.getByTestId('tabbed-content')).not.toBeAttached();
  });

  test('mobile viewport shows tabbed layout', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    token = await login(page);
    ({ slug, projectPath } = await createProject(page, token));

    // Tabs mode: tab bar visible, layout toggle hidden on mobile
    await expect(page.getByTestId('tab-bar')).toBeVisible();
    await expect(page.getByTestId('layout-toggle')).not.toBeAttached();

    // Tabbed content container is present
    await expect(page.getByTestId('tabbed-content')).toBeVisible();

    // Tab buttons for each visible pane (CLI + Claude)
    await expect(page.getByTestId('tab-0')).toBeVisible();
    await expect(page.getByTestId('tab-1')).toBeVisible();

    // Only the focused pane (first by default) is visible
    await expect(page.getByTestId('pane-0')).toBeVisible();
    await expect(page.getByTestId('pane-1')).not.toBeVisible();

    // Click second tab, second pane becomes visible
    await page.getByTestId('tab-1').click();
    await expect(page.getByTestId('pane-1')).toBeVisible();
    await expect(page.getByTestId('pane-0')).not.toBeVisible();
  });

  test('toggle pane visibility hides and shows panes', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    token = await login(page);
    ({ slug, projectPath } = await createProject(page, token));

    // Both panes start visible (CLI + Claude)
    await expect(page.getByTestId('pane-0')).toBeVisible();
    await expect(page.getByTestId('pane-1')).toBeVisible();

    // Hide the Claude pane (index 1) — now only CLI remains
    await page.getByTestId('visibility-1').click();
    await expect(page.getByTestId('pane-1')).not.toBeVisible();
    await expect(page.getByTestId('pane-0')).toBeVisible();

    // Cannot hide the last visible pane — button is disabled
    const lastToggle = page.getByTestId('visibility-0');
    await expect(lastToggle).toBeDisabled();

    // Re-show a hidden pane
    await page.getByTestId('visibility-1').click();
    await expect(page.getByTestId('pane-1')).toBeVisible();
  });
});
