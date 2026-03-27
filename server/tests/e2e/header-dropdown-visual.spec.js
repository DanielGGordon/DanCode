import { test, expect } from '@playwright/test';
import { login, createProject, cleanupProject } from './e2e-helpers.js';

const PROJECT_A = `Visual Dropdown A ${Date.now()}`;
const PROJECT_B = `Visual Dropdown B ${Date.now()}`;

/**
 * Visual assertion: "a top header bar shows the project name, with a dropdown list of other projects open below it"
 */
test.describe('Header dropdown visual', () => {
  let token;
  const created = [];

  test.afterEach(async ({ request }) => {
    for (const { slug, projectPath } of created) {
      await cleanupProject(request, slug, token, projectPath);
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
      await cleanupProject(request, proj.slug, token, null);
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
      return { top: rect.top, left: rect.left, width: rect.width, viewportWidth: window.innerWidth };
    });

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
      return {
        headerBottom: header.getBoundingClientRect().bottom,
        dropdownTop: dd.getBoundingClientRect().top,
        dropdownItems: dd.querySelectorAll('li').length,
      };
    });

    expect(positions.dropdownTop).toBeGreaterThanOrEqual(positions.headerBottom - 5);
    expect(positions.dropdownItems).toBeGreaterThanOrEqual(2);

    // 4. Verify both project items are visible in the dropdown
    const itemA = page.getByTestId(`dropdown-item-${a.slug}`);
    const itemB = page.getByTestId(`dropdown-item-${b.slug}`);
    await expect(itemA).toBeVisible();
    await expect(itemB).toBeVisible();

    // Active project (B) should have a checkmark
    await expect(itemB).toContainText('\u2713');
    await expect(itemA).not.toContainText('\u2713');

    // 5. Verify Solarized Dark styling
    const styles = await page.evaluate(() => {
      const header = document.querySelector('header');
      const dd = document.querySelector('[data-testid="header-dropdown"]');
      return {
        headerBg: window.getComputedStyle(header).backgroundColor,
        dropdownBg: window.getComputedStyle(dd).backgroundColor,
      };
    });

    function isDarkSolarized(rgb) {
      const match = rgb.match(/(\d+),\s*(\d+),\s*(\d+)/);
      if (!match) return false;
      const [, r, g, b] = match.map(Number);
      return r <= 20 && g <= 70 && b <= 80;
    }

    expect(isDarkSolarized(styles.headerBg)).toBe(true);
    expect(isDarkSolarized(styles.dropdownBg)).toBe(true);
  });
});
