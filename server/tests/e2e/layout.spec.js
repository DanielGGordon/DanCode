import { test, expect } from '@playwright/test';
import { login, createProject, cleanupProject } from './e2e-helpers.js';

const PROJECT_NAME = `Layout E2E ${Date.now()}`;

test.describe('Multi-terminal layout', () => {
  let slug;
  let token;
  let projectPath;

  test.afterEach(async ({ request }) => {
    await cleanupProject(request, slug, token, projectPath);
  });

  test('desktop viewport shows split layout with panes side by side', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    token = await login(page);
    ({ slug, projectPath } = await createProject(page, PROJECT_NAME));

    // Split mode: no tab bar, layout toggle visible
    await expect(page.getByTestId('tab-bar')).not.toBeVisible();
    await expect(page.getByTestId('layout-toggle')).toBeVisible();

    // Both panes are visible (CLI + Claude)
    await expect(page.getByTestId('terminal-pane-0')).toBeVisible();
    await expect(page.getByTestId('terminal-pane-1')).toBeVisible();

    // No tabbed-content container in split mode
    await expect(page.getByTestId('tabbed-content')).not.toBeAttached();
  });

  test('mobile viewport shows tabbed layout', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    token = await login(page);
    ({ slug, projectPath } = await createProject(page, PROJECT_NAME));

    // Tabs mode: tab bar visible, layout toggle hidden on mobile
    await expect(page.getByTestId('tab-bar')).toBeVisible();
    await expect(page.getByTestId('layout-toggle')).not.toBeAttached();

    // Tabbed content container is present
    await expect(page.getByTestId('tabbed-content')).toBeVisible();

    // Tab buttons for each terminal
    await expect(page.getByTestId('tab-0')).toBeVisible();
    await expect(page.getByTestId('tab-1')).toBeVisible();

    // Only the focused terminal (first by default) is visible
    await expect(page.getByTestId('terminal-pane-0')).toBeVisible();
    await expect(page.getByTestId('terminal-pane-1')).not.toBeVisible();

    // Click second tab, second terminal becomes visible
    await page.getByTestId('tab-1').click();
    await expect(page.getByTestId('terminal-pane-1')).toBeVisible();
    await expect(page.getByTestId('terminal-pane-0')).not.toBeVisible();
  });

  test('close terminal with confirmation dialog', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    token = await login(page);
    ({ slug, projectPath } = await createProject(page, PROJECT_NAME));

    // Both panes start visible (CLI + Claude)
    await expect(page.getByTestId('terminal-pane-0')).toBeVisible();
    await expect(page.getByTestId('terminal-pane-1')).toBeVisible();

    // Click close on the second terminal — shows confirmation
    await page.getByTestId('close-terminal-1').click();
    await expect(page.getByTestId('confirm-delete-overlay')).toBeVisible();

    // Cancel dismisses the dialog
    await page.getByTestId('confirm-delete-cancel').click();
    await expect(page.getByTestId('confirm-delete-overlay')).not.toBeAttached();

    // Both terminals still visible
    await expect(page.getByTestId('terminal-pane-0')).toBeVisible();
    await expect(page.getByTestId('terminal-pane-1')).toBeVisible();
  });
});
