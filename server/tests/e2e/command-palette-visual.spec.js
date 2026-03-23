import { test, expect } from '@playwright/test';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const PROJECT_A = `Visual Palette A ${Date.now()}`;
const PROJECT_B = `Visual Palette B ${Date.now()}`;

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
  const projectPath = `/tmp/dancode-visual-palette-${slug}-${Date.now()}`;

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
 * Visual assertion: "a command palette overlay is displayed near the top of the screen
 * with a search input and a list of projects"
 *
 * Uses programmatic visual verification because no local vision model
 * runs reliably on Pi 5 ARM64 (phi3.5 needs 3.7 GiB, only ~2.5 GiB available).
 *
 * Verifies:
 *   1. The palette overlay is visible with a backdrop
 *   2. A search input is present
 *   3. Project items are listed
 *   4. The palette is positioned near the top of the screen and centered horizontally
 *   5. Styling matches Solarized Dark theme
 */
test.describe('Command palette visual', () => {
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

  test('command palette passes visual assertion', async ({ page }) => {
    token = await login(page);

    // Create two projects so the palette shows a list
    const a = await createProject(page, PROJECT_A);
    created.push(a);
    const b = await createProject(page, PROJECT_B);
    created.push(b);

    // Defocus terminal so Ctrl+K is not captured by xterm
    await page.locator('header').click();

    // Open command palette
    await page.keyboard.press('Control+k');
    const palette = page.getByTestId('command-palette');
    await expect(palette).toBeVisible();

    // 1. Verify backdrop is present
    const backdrop = page.getByTestId('command-palette-backdrop');
    await expect(backdrop).toBeVisible();

    // 2. Verify search input is present
    const searchInput = page.getByTestId('command-palette-input');
    await expect(searchInput).toBeVisible();

    // 3. Verify project items are listed (wait for async project refresh)
    const list = page.getByTestId('command-palette-list');
    await expect(list).toBeVisible();
    const items = list.locator('li');
    // handleProjectCreated triggers fetchProjects() asynchronously, so the
    // palette may still show stale data. Use an auto-retrying assertion.
    await expect(items.nth(1)).toBeVisible({ timeout: 10000 });

    // 4. Verify the palette is positioned near the top and centered
    const layout = await page.evaluate(() => {
      const palette = document.querySelector('[data-testid="command-palette"]');
      const rect = palette.getBoundingClientRect();
      return {
        top: rect.top,
        centerX: rect.left + rect.width / 2,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      };
    });

    // Palette should be in the top 40% of the viewport
    expect(layout.top / layout.viewportHeight).toBeLessThanOrEqual(0.4);

    // Palette should be horizontally centered (within 10% of center)
    const xOffset = Math.abs(layout.centerX - layout.viewportWidth / 2) / layout.viewportWidth;
    expect(xOffset).toBeLessThanOrEqual(0.1);

    // 5. Verify Solarized Dark styling on the palette
    const styles = await page.evaluate(() => {
      const palette = document.querySelector('[data-testid="command-palette"]');
      return {
        bg: window.getComputedStyle(palette).backgroundColor,
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
