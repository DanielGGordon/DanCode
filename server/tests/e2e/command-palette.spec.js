import { test, expect } from '@playwright/test';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const PROJECT_A = `Palette A ${Date.now()}`;
const PROJECT_B = `Palette B ${Date.now()}`;

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
  const projectPath = `/tmp/dancode-palette-e2e-${slug}-${Date.now()}`;

  await page.getByTestId('new-project-button').click();
  const form = page.getByTestId('new-project-form');
  await expect(form).toBeVisible();

  await page.getByTestId('project-name-input').fill(name);
  const pathInput = page.getByTestId('project-path-input');
  await pathInput.clear();
  await pathInput.fill(projectPath);
  await page.getByTestId('new-project-submit').click();

  // Wait for PaneLayout to appear with the new project
  await expect(page.getByTestId('pane-layout')).toBeVisible({ timeout: 15000 });

  return { slug, projectPath };
}

test.describe('Command palette project switching', () => {
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

  test('Ctrl+K opens palette, type project name, enter switches, terminals update', async ({ page }) => {
    token = await login(page);

    // Create two projects so we have something to switch between
    ({ slug: slugA, projectPath: pathA } = await createProject(page, PROJECT_A));
    ({ slug: slugB, projectPath: pathB } = await createProject(page, PROJECT_B));

    // We should now be viewing Project B (the most recently created)
    const terminals = page.getByTestId('terminal');
    await expect(terminals.first()).toHaveAttribute('data-slug', slugB);

    // Click the header to defocus the terminal (xterm uses a textarea that blocks Ctrl+K)
    await page.locator('header').click();

    // Open command palette with Ctrl+K
    await page.keyboard.press('Control+k');
    await expect(page.getByTestId('command-palette')).toBeVisible();

    // The search input should be focused
    const paletteInput = page.getByTestId('command-palette-input');
    await expect(paletteInput).toBeVisible();
    await expect(paletteInput).toBeFocused();

    // Both projects should be listed
    await expect(page.getByTestId(`command-palette-item-${slugA}`)).toBeVisible();
    await expect(page.getByTestId(`command-palette-item-${slugB}`)).toBeVisible();

    // Type Project A's name to filter
    await paletteInput.fill(PROJECT_A);

    // Only Project A should be visible in the filtered list
    await expect(page.getByTestId(`command-palette-item-${slugA}`)).toBeVisible();
    await expect(page.getByTestId(`command-palette-item-${slugB}`)).not.toBeAttached();

    // Press Enter to select Project A
    await page.keyboard.press('Enter');

    // Palette should close
    await expect(page.getByTestId('command-palette')).not.toBeAttached();

    // PaneLayout should appear for the new project
    await expect(page.getByTestId('pane-layout')).toBeVisible({ timeout: 15000 });

    // Terminals should now show Project A's slug
    const updatedTerminals = page.getByTestId('terminal');
    await expect(updatedTerminals.first()).toHaveAttribute('data-slug', slugA);

    // xterm.js should render inside the terminal
    const xtermElement = page.locator('.xterm');
    await expect(xtermElement.first()).toBeVisible({ timeout: 10000 });
  });
});
