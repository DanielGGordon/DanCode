import { test, expect } from '@playwright/test';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const PROJECT_A = `Dropdown A ${Date.now()}`;
const PROJECT_B = `Dropdown B ${Date.now()}`;

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

async function createProject(page, name) {
  const slug = slugify(name);
  const projectPath = `/tmp/dancode-dropdown-e2e-${slug}-${Date.now()}`;

  await page.getByTestId('new-project-button').click();
  const form = page.getByTestId('new-project-form');
  await expect(form).toBeVisible();

  await page.getByTestId('project-name-input').fill(name);
  const pathInput = page.getByTestId('project-path-input');
  await pathInput.clear();
  await pathInput.fill(projectPath);
  await page.getByTestId('new-project-submit').click();

  // Wait for a terminal with this project's slug to appear
  await expect(page.locator(`[data-testid="terminal"][data-slug="${slug}"]`).first()).toBeVisible({ timeout: 15000 });

  return { slug, projectPath };
}

test.describe('Header dropdown project switching', () => {
  let slugA;
  let slugB;
  let token;
  let pathA;
  let pathB;

  test.afterEach(async ({ request }) => {
    if (!token) return;

    for (const slug of [slugA, slugB]) {
      if (!slug) continue;
      try {
        await request.delete(`/api/projects/${slug}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch { /* best-effort */ }
      try {
        await execFileAsync('tmux', ['kill-session', '-t', `dancode-${slug}`]);
      } catch { /* session may not exist */ }
    }

    for (const p of [pathA, pathB]) {
      if (!p) continue;
      try {
        await rm(p, { recursive: true, force: true });
      } catch { /* best-effort */ }
    }
  });

  test('click header project name opens dropdown, select project switches terminals', async ({ page }) => {
    token = await login(page);

    // Create two projects so we have something to switch between
    ({ slug: slugA, projectPath: pathA } = await createProject(page, PROJECT_A));
    ({ slug: slugB, projectPath: pathB } = await createProject(page, PROJECT_B));

    // We should now be viewing Project B (the most recently created)
    const terminals = page.getByTestId('terminal');
    await expect(terminals.first()).toHaveAttribute('data-slug', slugB);

    // Header should show the current project name
    const headerProjectName = page.getByTestId('header-project-name');
    await expect(headerProjectName).toBeVisible();
    await expect(headerProjectName).toContainText(PROJECT_B);

    // Dropdown should not be visible yet
    await expect(page.getByTestId('header-dropdown')).not.toBeAttached();

    // Click the project name to open the dropdown
    await headerProjectName.click();

    // Dropdown should appear with both projects listed
    const dropdown = page.getByTestId('header-dropdown');
    await expect(dropdown).toBeVisible();
    await expect(page.getByTestId(`dropdown-item-${slugA}`)).toBeVisible();
    await expect(page.getByTestId(`dropdown-item-${slugB}`)).toBeVisible();

    // Active project (B) should have a checkmark
    const itemB = page.getByTestId(`dropdown-item-${slugB}`);
    await expect(itemB).toContainText('✓');

    // Project A should not have a checkmark
    const itemA = page.getByTestId(`dropdown-item-${slugA}`);
    await expect(itemA).not.toContainText('✓');

    // Click Project A to switch
    await itemA.click();

    // Dropdown should close after selection
    await expect(page.getByTestId('header-dropdown')).not.toBeAttached();

    // PaneLayout should appear for the new project
    await expect(page.getByTestId('pane-layout')).toBeVisible({ timeout: 15000 });

    // Terminals should now show Project A's slug
    const updatedTerminals = page.getByTestId('terminal');
    await expect(updatedTerminals.first()).toHaveAttribute('data-slug', slugA);

    // Header should now show Project A's name
    await expect(page.getByTestId('header-project-name')).toContainText(PROJECT_A);

    // xterm.js should render inside the terminal
    const xtermElement = page.locator('.xterm');
    await expect(xtermElement.first()).toBeVisible({ timeout: 10000 });

    // Re-open dropdown and verify Project A now has the checkmark
    await page.getByTestId('header-project-name').click();
    await expect(page.getByTestId('header-dropdown')).toBeVisible();
    await expect(page.getByTestId(`dropdown-item-${slugA}`)).toContainText('✓');
    await expect(page.getByTestId(`dropdown-item-${slugB}`)).not.toContainText('✓');
  });
});
