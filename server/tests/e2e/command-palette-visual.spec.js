import { test, expect } from '@playwright/test';
import { login, createProject, cleanupProject } from './e2e-helpers.js';

const PROJECT_A = `Visual Palette A ${Date.now()}`;
const PROJECT_B = `Visual Palette B ${Date.now()}`;

/**
 * Visual assertion: "a command palette overlay is displayed near the top of the screen
 * with a search input and a list of projects"
 */
test.describe('Command palette visual', () => {
  let token;
  const created = [];

  test.afterEach(async ({ request }) => {
    for (const { slug, projectPath } of created) {
      await cleanupProject(request, slug, token, projectPath);
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

    // 3. Verify project items are listed
    const list = page.getByTestId('command-palette-list');
    await expect(list).toBeVisible();
    const items = list.locator('li');
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

    expect(layout.top / layout.viewportHeight).toBeLessThanOrEqual(0.4);
    const xOffset = Math.abs(layout.centerX - layout.viewportWidth / 2) / layout.viewportWidth;
    expect(xOffset).toBeLessThanOrEqual(0.1);

    // 5. Verify Solarized Dark styling
    const styles = await page.evaluate(() => {
      const palette = document.querySelector('[data-testid="command-palette"]');
      return { bg: window.getComputedStyle(palette).backgroundColor };
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
