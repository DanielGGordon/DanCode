import { test, expect } from '@playwright/test';
import { login, createProject, cleanupProject } from './e2e-helpers.js';

const PROJECT_A = `Sidebar A ${Date.now()}`;
const PROJECT_B = `Sidebar B ${Date.now()}`;

test.describe('Sidebar project switching', () => {
  let slugA;
  let slugB;
  let token;
  let pathA;
  let pathB;

  test.afterEach(async ({ request }) => {
    await cleanupProject(request, slugA, token, pathA);
    await cleanupProject(request, slugB, token, pathB);
  });

  test('click project in sidebar switches terminals to that project', async ({ page }) => {
    token = await login(page);

    // Create two projects so we have something to switch between
    ({ slug: slugA, projectPath: pathA } = await createProject(page, PROJECT_A));
    ({ slug: slugB, projectPath: pathB } = await createProject(page, PROJECT_B));

    // We should now be viewing Project B (the most recently created)
    await expect(page.getByTestId('terminal-layout')).toHaveAttribute('data-slug', slugB);

    // Sidebar should be visible and list both projects
    const sidebar = page.getByTestId('sidebar');
    await expect(sidebar).toBeVisible();

    const projectAItem = page.getByTestId(`sidebar-project-${slugA}`);
    const projectBItem = page.getByTestId(`sidebar-project-${slugB}`);
    await expect(projectAItem).toBeVisible();
    await expect(projectBItem).toBeVisible();

    // Project B should be the active/highlighted one
    await expect(projectBItem).toHaveClass(/border-blue/);
    await expect(projectAItem).not.toHaveClass(/border-blue/);

    // Click Project A in the sidebar to switch
    await projectAItem.click();

    // TerminalLayout should appear for the new project
    await expect(page.getByTestId('terminal-layout')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('terminal-layout')).toHaveAttribute('data-slug', slugA);

    // Project A should now be highlighted in the sidebar
    await expect(page.getByTestId(`sidebar-project-${slugA}`)).toHaveClass(/border-blue/);
    await expect(page.getByTestId(`sidebar-project-${slugB}`)).not.toHaveClass(/border-blue/);

    // xterm.js should render inside the terminal
    const xtermElement = page.locator('.xterm');
    await expect(xtermElement.first()).toBeVisible({ timeout: 10000 });
  });
});
