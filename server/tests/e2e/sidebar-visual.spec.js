import { test, expect } from '@playwright/test';
import { login, createProject, cleanupProject } from './e2e-helpers.js';

const PROJECT_A = `Visual Sidebar A ${Date.now()}`;
const PROJECT_B = `Visual Sidebar B ${Date.now()}`;

/**
 * Visual assertion: "a collapsible sidebar on the left lists project names, one is highlighted as active"
 */
test.describe('Sidebar visual', () => {
  let token;
  const created = [];

  test.afterEach(async ({ request }) => {
    for (const { slug, projectPath } of created) {
      await cleanupProject(request, slug, token, projectPath);
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
      await cleanupProject(request, proj.slug, token, null);
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
      return { bg: window.getComputedStyle(el).backgroundColor };
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
