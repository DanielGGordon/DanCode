import { test, expect } from '@playwright/test';
import { login, createProject, cleanupProject } from './e2e-helpers.js';

const PROJECT_A = `Palette A ${Date.now()}`;
const PROJECT_B = `Palette B ${Date.now()}`;

test.describe('Command palette project switching', () => {
  let slugA;
  let slugB;
  let token;
  let pathA;
  let pathB;

  test.afterEach(async ({ request }) => {
    await cleanupProject(request, slugA, token, pathA);
    await cleanupProject(request, slugB, token, pathB);
  });

  test('Ctrl+K opens palette, type project name, enter switches, terminal layout updates', async ({ page }) => {
    token = await login(page);

    // Create two projects so we have something to switch between
    ({ slug: slugA, projectPath: pathA } = await createProject(page, PROJECT_A));
    ({ slug: slugB, projectPath: pathB } = await createProject(page, PROJECT_B));

    // We should now be viewing Project B (the most recently created)
    await expect(page.getByTestId('terminal-layout')).toHaveAttribute('data-slug', slugB);

    // Click the header to defocus the terminal (xterm uses a textarea that blocks Ctrl+K)
    await page.locator('header').click();

    // Open command palette with Ctrl+K
    await page.keyboard.press('Control+k');
    await expect(page.getByTestId('command-palette')).toBeVisible();

    // The search input should be focused
    const paletteInput = page.getByTestId('command-palette-input');
    await expect(paletteInput).toBeVisible();
    await expect(paletteInput).toBeFocused();

    // Both projects should be listed
    await expect(page.getByTestId(`command-palette-item-${slugA}`)).toBeVisible();
    await expect(page.getByTestId(`command-palette-item-${slugB}`)).toBeVisible();

    // Type Project A's name to filter
    await paletteInput.fill(PROJECT_A);

    // Only Project A should be visible in the filtered list
    await expect(page.getByTestId(`command-palette-item-${slugA}`)).toBeVisible();
    await expect(page.getByTestId(`command-palette-item-${slugB}`)).not.toBeAttached();

    // Press Enter to select Project A
    await page.keyboard.press('Enter');

    // Palette should close
    await expect(page.getByTestId('command-palette')).not.toBeAttached();

    // TerminalLayout should appear for the new project
    await expect(page.getByTestId('terminal-layout')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('terminal-layout')).toHaveAttribute('data-slug', slugA);

    // xterm.js should render inside the terminal
    const xtermElement = page.locator('.xterm');
    await expect(xtermElement.first()).toBeVisible({ timeout: 10000 });
  });
});
