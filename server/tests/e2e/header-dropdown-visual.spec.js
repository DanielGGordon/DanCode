import { test, expect } from '@playwright/test';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const PROJECT_A = `Visual Dropdown A ${Date.now()}`;
const PROJECT_B = `Visual Dropdown B ${Date.now()}`;

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
  const projectPath = `/tmp/dancode-visual-dropdown-${slug}-${Date.now()}`;

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
 * Visual assertion: "a top header bar shows the project name, with a dropdown list of other projects open below it"
 *
 * Uses programmatic visual verification because no local vision model
 * runs reliably on Pi 5 ARM64 (phi3.5 context window too small for DOM prompts).
 *
 * Verifies:
 *   1. A header bar spans the top of the page
 *   2. The current project name is displayed in the header
 *   3. A dropdown list appears below with all projects listed
 *   4. The active project has a checkmark indicator
 *   5. Styling matches Solarized Dark theme
 */
test.describe('Header dropdown visual', () => {
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

  test('visual: a top header bar shows the project name, with a dropdown list of other projects open below it', async ({ page, request }) => {
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

    // Create two projects so the dropdown shows a list
    const a = await createProject(page, PROJECT_A);
    created.push(a);
    const b = await createProject(page, PROJECT_B);
    created.push(b);

    // 1. Verify header bar spans the top of the page
    const header = page.locator('header');
    await expect(header).toBeVisible();

    const headerMetrics = await header.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return {
        top: rect.top,
        left: rect.left,
        width: rect.width,
        viewportWidth: window.innerWidth,
      };
    });

    // Header should be at the very top and span full width
    expect(headerMetrics.top).toBeLessThanOrEqual(2);
    expect(headerMetrics.left).toBeLessThanOrEqual(2);
    expect(headerMetrics.width / headerMetrics.viewportWidth).toBeGreaterThanOrEqual(0.95);

    // 2. Verify the current project name is displayed in the header
    const headerProjectName = page.getByTestId('header-project-name');
    await expect(headerProjectName).toBeVisible();
    await expect(headerProjectName).toContainText(PROJECT_B);

    // 3. Open the dropdown and verify it appears below the header
    await headerProjectName.click();
    const dropdown = page.getByTestId('header-dropdown');
    await expect(dropdown).toBeVisible();

    const positions = await page.evaluate(() => {
      const header = document.querySelector('header');
      const dd = document.querySelector('[data-testid="header-dropdown"]');
      const headerRect = header.getBoundingClientRect();
      const ddRect = dd.getBoundingClientRect();
      return {
        headerBottom: headerRect.bottom,
        dropdownTop: ddRect.top,
        dropdownItems: dd.querySelectorAll('li').length,
      };
    });

    // Dropdown should appear below the header
    expect(positions.dropdownTop).toBeGreaterThanOrEqual(positions.headerBottom - 5);
    // Both projects should be listed
    expect(positions.dropdownItems).toBeGreaterThanOrEqual(2);

    // 4. Verify both project items are visible in the dropdown
    const itemA = page.getByTestId(`dropdown-item-${a.slug}`);
    const itemB = page.getByTestId(`dropdown-item-${b.slug}`);
    await expect(itemA).toBeVisible();
    await expect(itemB).toBeVisible();

    // Active project (B) should have a checkmark
    await expect(itemB).toContainText('✓');
    await expect(itemA).not.toContainText('✓');

    // 5. Verify Solarized Dark styling on header and dropdown
    const styles = await page.evaluate(() => {
      const header = document.querySelector('header');
      const dd = document.querySelector('[data-testid="header-dropdown"]');
      const headerStyle = window.getComputedStyle(header);
      const ddStyle = window.getComputedStyle(dd);
      return {
        headerBg: headerStyle.backgroundColor,
        dropdownBg: ddStyle.backgroundColor,
        dropdownBorder: ddStyle.borderColor || ddStyle.borderTopColor,
      };
    });

    // Header and dropdown backgrounds should be dark (Solarized Dark palette)
    // base02 = #073642 = rgb(7, 54, 66) or base03 = #002b36 = rgb(0, 43, 54)
    function isDarkSolarized(rgb) {
      const match = rgb.match(/(\d+),\s*(\d+),\s*(\d+)/);
      if (!match) return false;
      const [, r, g, b] = match.map(Number);
      // Dark solarized backgrounds have low R, moderate G and B
      return r <= 20 && g <= 70 && b <= 80;
    }

    expect(isDarkSolarized(styles.headerBg)).toBe(true);
    expect(isDarkSolarized(styles.dropdownBg)).toBe(true);
  });
});
