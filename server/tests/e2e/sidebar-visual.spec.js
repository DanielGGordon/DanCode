import { test, expect } from '@playwright/test';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const PROJECT_A = `Visual Sidebar A ${Date.now()}`;
const PROJECT_B = `Visual Sidebar B ${Date.now()}`;

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
  const projectPath = `/tmp/dancode-visual-sidebar-${slug}-${Date.now()}`;

  await page.getByTestId('new-project-button').click();
  const form = page.getByTestId('new-project-form');
  await expect(form).toBeVisible();

  await page.getByTestId('project-name-input').fill(name);
  const pathInput = page.getByTestId('project-path-input');
  await pathInput.clear();
  await pathInput.fill(projectPath);
  await page.getByTestId('new-project-submit').click();

  await expect(page.locator(`[data-testid="terminal"][data-slug="${slug}"]`).first()).toBeVisible({ timeout: 15000 });

  return { slug, projectPath };
}

/**
 * Visual assertion: "a collapsible sidebar on the left lists project names, one is highlighted as active"
 *
 * Uses programmatic visual verification because no local vision model
 * runs reliably on Pi 5 ARM64 (phi3.5 needs 3.7 GiB, only ~2.5 GiB available).
 *
 * Verifies:
 *   1. The sidebar is on the left side of the page
 *   2. Project names are listed in the sidebar
 *   3. The active project is highlighted (border-blue class)
 *   4. A collapse/expand toggle is present
 *   5. Styling matches Solarized Dark theme
 */
test.describe('Sidebar visual', () => {
  let token;
  const created = [];

  test.afterEach(async ({ request }) => {
    for (const { slug, projectPath } of created) {
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
    }
  });

  test('sidebar passes visual assertion', async ({ page, request }) => {
    token = await login(page);

    // Delete all pre-existing projects so the test is hermetic
    const res = await request.get('/api/projects', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const existing = await res.json();
    for (const proj of existing) {
      try {
        await request.delete(`/api/projects/${proj.slug}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch { /* best-effort */ }
      try {
        await execFileAsync('tmux', ['kill-session', '-t', `dancode-${proj.slug}`]);
      } catch { /* session may not exist */ }
    }
    await page.reload();
    await expect(page.getByTestId('new-project-button')).toBeVisible();

    // Create two projects so the sidebar shows a list
    const a = await createProject(page, PROJECT_A);
    created.push(a);
    const b = await createProject(page, PROJECT_B);
    created.push(b);

    // 1. Verify sidebar is visible and on the left
    const sidebar = page.getByTestId('sidebar');
    await expect(sidebar).toBeVisible();

    const sidebarPos = await sidebar.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return { left: rect.left, top: rect.top, width: rect.width };
    });

    expect(sidebarPos.left).toBeLessThanOrEqual(2);
    expect(sidebarPos.width).toBeGreaterThanOrEqual(100);

    // 2. Verify project names are listed
    const projectList = page.getByTestId('sidebar-project-list');
    await expect(projectList).toBeVisible();

    const itemA = page.getByTestId(`sidebar-project-${a.slug}`);
    const itemB = page.getByTestId(`sidebar-project-${b.slug}`);
    await expect(itemA).toBeVisible();
    await expect(itemB).toBeVisible();

    // 3. Verify active project (B, most recently created) has highlight
    await expect(itemB).toHaveClass(/border-blue/);

    // 4. Verify toggle button is present
    const toggle = page.getByTestId('sidebar-toggle');
    await expect(toggle).toBeVisible();

    // 5. Verify Solarized Dark styling
    const styles = await sidebar.evaluate((el) => {
      return {
        bg: window.getComputedStyle(el).backgroundColor,
      };
    });

    function isDarkSolarized(rgb) {
      const match = rgb.match(/(\d+),\s*(\d+),\s*(\d+)/);
      if (!match) return false;
      const [, r, g, b] = match.map(Number);
      return r <= 20 && g <= 70 && b <= 80;
    }

    expect(isDarkSolarized(styles.bg)).toBe(true);
  });
});
