import { test, expect } from '@playwright/test';
import { login, createProject, cleanupProject } from './e2e-helpers.js';

const PROJECT_A = `Dropdown A ${Date.now()}`;
const PROJECT_B = `Dropdown B ${Date.now()}`;

test.describe('Header dropdown project switching', () => {
  let slugA;
  let slugB;
  let token;
  let pathA;
  let pathB;

  test.afterEach(async ({ request }) => {
    await cleanupProject(request, slugA, token, pathA);
    await cleanupProject(request, slugB, token, pathB);
  });

  test('click header project name opens dropdown, select project switches terminals', async ({ page }) => {
    token = await login(page);

    // Create two projects so we have something to switch between
    ({ slug: slugA, projectPath: pathA } = await createProject(page, PROJECT_A));
    ({ slug: slugB, projectPath: pathB } = await createProject(page, PROJECT_B));

    // We should now be viewing Project B (the most recently created)
    await expect(page.getByTestId('terminal-layout')).toHaveAttribute('data-slug', slugB);

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

    // TerminalLayout should appear for the new project
    await expect(page.getByTestId('terminal-layout')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('terminal-layout')).toHaveAttribute('data-slug', slugA);

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
