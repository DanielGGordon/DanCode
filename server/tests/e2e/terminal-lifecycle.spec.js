import { test, expect } from '@playwright/test';
import { login, createProject, cleanupProject } from './e2e-helpers.js';

const PROJECT_NAME = `Lifecycle ${Date.now()}`;

/**
 * Full terminal lifecycle E2E test:
 *   1. Create project → 2 default terminals (CLI + Claude)
 *   2. Add a 3rd terminal
 *   3. Rename a terminal
 *   4. Close a terminal (with confirmation)
 *   5. Switch between split and tabs modes
 */
test.describe('Terminal lifecycle', () => {
  let token;
  const created = [];

  test.afterEach(async ({ request }) => {
    for (const { slug, projectPath } of created) {
      await cleanupProject(request, slug, token, projectPath);
    }
  });

  test('create project, add/rename/close terminals, switch layout modes', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    token = await login(page);

    // 1. Create project — should auto-create 2 terminals (CLI + Claude)
    const proj = await createProject(page, PROJECT_NAME);
    created.push(proj);

    const pane0 = page.getByTestId('terminal-pane-0');
    const pane1 = page.getByTestId('terminal-pane-1');
    await expect(pane0).toBeVisible({ timeout: 10000 });
    await expect(pane1).toBeVisible({ timeout: 10000 });

    // Verify default labels
    await expect(pane0).toContainText('CLI');
    await expect(pane1).toContainText('Claude');

    // Verify xterm rendered in both panes
    await expect(pane0.locator('.xterm')).toBeVisible({ timeout: 10000 });
    await expect(pane1.locator('.xterm')).toBeVisible({ timeout: 10000 });

    // 2. Add a 3rd terminal
    await page.getByTestId('add-terminal-button').click();
    const pane2 = page.getByTestId('terminal-pane-2');
    await expect(pane2).toBeVisible({ timeout: 10000 });
    await expect(pane2.locator('.xterm')).toBeVisible({ timeout: 10000 });

    // 3. Rename the 3rd terminal by double-clicking its label
    const pane2Label = pane2.locator('span').first();
    await pane2Label.dblclick();
    const editInput = page.getByTestId('pane-edit-2');
    await expect(editInput).toBeVisible();
    await editInput.fill('My Shell');
    await editInput.press('Enter');

    // Verify the label updated
    await expect(pane2).toContainText('My Shell');

    // 4. Close the 3rd terminal — first click opens confirm dialog
    await page.getByTestId('close-terminal-2').click();
    const overlay = page.getByTestId('confirm-delete-overlay');
    await expect(overlay).toBeVisible();

    // Click "Close Terminal" to confirm
    await page.getByTestId('confirm-delete-yes').click();
    await expect(overlay).not.toBeAttached({ timeout: 5000 });
    await expect(pane2).not.toBeAttached({ timeout: 5000 });

    // Original 2 panes should still be present
    await expect(pane0).toBeVisible();
    await expect(pane1).toBeVisible();

    // 5. Switch to tabs mode
    const layoutToggle = page.getByTestId('layout-toggle');
    await expect(layoutToggle).toContainText('Tabs');
    await layoutToggle.click();

    // Should now show tab bar
    const tabBar = page.getByTestId('tab-bar');
    await expect(tabBar).toBeVisible();
    await expect(page.getByTestId('tab-0')).toBeVisible();
    await expect(page.getByTestId('tab-1')).toBeVisible();

    // Layout toggle should now say "Split"
    await expect(layoutToggle).toContainText('Split');

    // Only the focused tab's pane should be visible
    // Focus tab 1 (Claude)
    await page.getByTestId('tab-1').click();
    const tabbedContent = page.getByTestId('tabbed-content');
    await expect(tabbedContent).toBeVisible();

    // Switch back to split mode
    await layoutToggle.click();
    await expect(tabBar).not.toBeAttached();
    await expect(pane0).toBeVisible();
    await expect(pane1).toBeVisible();
  });
});
