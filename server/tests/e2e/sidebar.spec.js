import { test, expect } from '@playwright/test';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const PROJECT_A = `Sidebar A ${Date.now()}`;
const PROJECT_B = `Sidebar B ${Date.now()}`;

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
  const projectPath = `/tmp/dancode-sidebar-e2e-${slug}-${Date.now()}`;

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

test.describe('Sidebar project switching', () => {
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

  test('click project in sidebar switches terminals to that project', async ({ page }) => {
    token = await login(page);

    // Create two projects so we have something to switch between
    ({ slug: slugA, projectPath: pathA } = await createProject(page, PROJECT_A));
    ({ slug: slugB, projectPath: pathB } = await createProject(page, PROJECT_B));

    // We should now be viewing Project B (the most recently created)
    const terminals = page.getByTestId('terminal');
    await expect(terminals.first()).toHaveAttribute('data-slug', slugB);

    // Sidebar should be visible and list both projects
    const sidebar = page.getByTestId('sidebar');
    await expect(sidebar).toBeVisible();

    const projectAItem = page.getByTestId(`sidebar-project-${slugA}`);
    const projectBItem = page.getByTestId(`sidebar-project-${slugB}`);
    await expect(projectAItem).toBeVisible();
    await expect(projectBItem).toBeVisible();

    // Project B should be the active/highlighted one
    // (it has the border-blue class when active)
    await expect(projectBItem).toHaveClass(/border-blue/);
    await expect(projectAItem).not.toHaveClass(/border-blue/);

    // Click Project A in the sidebar to switch
    await projectAItem.click();

    // PaneLayout should appear for the new project
    await expect(page.getByTestId('pane-layout')).toBeVisible({ timeout: 15000 });

    // Terminals should now show Project A's slug
    const updatedTerminals = page.getByTestId('terminal');
    await expect(updatedTerminals.first()).toHaveAttribute('data-slug', slugA);

    // Project A should now be highlighted in the sidebar
    const updatedProjectAItem = page.getByTestId(`sidebar-project-${slugA}`);
    const updatedProjectBItem = page.getByTestId(`sidebar-project-${slugB}`);
    await expect(updatedProjectAItem).toHaveClass(/border-blue/);
    await expect(updatedProjectBItem).not.toHaveClass(/border-blue/);

    // xterm.js should render inside the terminal
    const xtermElement = page.locator('.xterm');
    await expect(xtermElement.first()).toBeVisible({ timeout: 10000 });
  });
});
