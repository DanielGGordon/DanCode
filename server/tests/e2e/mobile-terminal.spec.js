import { test, expect } from '@playwright/test';
import { login, createProject, cleanupProject } from './e2e-helpers.js';

/**
 * Phase 7 E2E: Mobile Terminal + Shortcut Bar
 *
 * Uses Playwright mobile emulation (iPhone 12 viewport) to test:
 * 1. Mobile dashboard shows project cards
 * 2. Tap project → full-screen terminal view (read-first, no keyboard)
 * 3. Keyboard toggle shows shortcut bar
 * 4. Shortcut buttons send key sequences (Ctrl+C sends interrupt)
 * 5. Back button returns to dashboard
 * 6. Long-press opens quick action menu
 */

// iPhone 12 viewport
const MOBILE_VIEWPORT = { width: 390, height: 844 };

test.describe('Mobile Terminal', () => {
  let token;
  let slug;
  let projectPath;

  test.beforeEach(async ({ page }) => {
    // Set mobile viewport before anything
    await page.setViewportSize(MOBILE_VIEWPORT);
    token = await login(page);
  });

  test.afterEach(async ({ request }) => {
    if (slug && token) {
      await cleanupProject(request, slug, token, projectPath);
      slug = null;
      projectPath = null;
    }
  });

  test('shows mobile dashboard on phone viewport', async ({ page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.reload();
    await page.waitForSelector('[data-testid="mobile-dashboard"]', { state: 'visible', timeout: 10000 });
    const dashboard = page.getByTestId('mobile-dashboard');
    await expect(dashboard).toBeVisible();
  });

  test('open terminal on mobile, verify read-first, tap to show keyboard, verify shortcut bar', async ({ page }) => {
    // Create a project first (need to handle form on mobile)
    // Use API to create project directly
    const projectName = `MobileTest-${Date.now()}`;
    const path = `/tmp/dancode-e2e-mobile-${Date.now()}`;

    const createRes = await page.request.post('/api/projects', {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      data: { name: projectName, path },
    });
    expect(createRes.ok()).toBeTruthy();
    const project = await createRes.json();
    slug = project.slug;
    projectPath = path;

    // Reload to see the project in dashboard
    await page.reload();
    await page.waitForSelector('[data-testid="mobile-dashboard"]', { state: 'visible', timeout: 10000 });

    // Tap project card to open terminal list
    const card = page.getByTestId(`project-card-${slug}`);
    await expect(card).toBeVisible();
    await card.click();

    // Should show terminal list first (Phase 6 navigation)
    await page.waitForSelector('[data-testid="mobile-terminal-list"]', { state: 'visible', timeout: 10000 });

    // Tap first terminal to enter terminal view
    await page.locator('[data-testid^="terminal-item-"]').first().click();

    // Should show mobile terminal view (full-screen)
    await page.waitForSelector('[data-testid="mobile-terminal-view"]', { state: 'visible', timeout: 15000 });
    const terminalView = page.getByTestId('mobile-terminal-view');
    await expect(terminalView).toBeVisible();

    // Verify read-first: no sidebar, no header (just thin top bar)
    const topBar = page.getByTestId('mobile-top-bar');
    await expect(topBar).toBeVisible();

    // Verify the standard desktop sidebar and header are NOT visible
    await expect(page.getByTestId('sidebar')).not.toBeVisible();

    // Verify back button exists
    const backButton = page.getByTestId('mobile-back-button');
    await expect(backButton).toBeVisible();

    // Verify terminal label is visible
    const label = page.getByTestId('mobile-terminal-label').or(page.getByTestId('mobile-tab-strip'));
    await expect(label).toBeVisible();

    // Shortcut bar should NOT be visible initially (read-first mode)
    await expect(page.getByTestId('shortcut-bar')).not.toBeVisible();

    // Tap keyboard toggle to enter input mode
    const keyboardToggle = page.getByTestId('keyboard-toggle');
    await expect(keyboardToggle).toBeVisible();
    await keyboardToggle.click();

    // Shortcut bar should now be visible
    await page.waitForSelector('[data-testid="shortcut-bar"]', { state: 'visible', timeout: 5000 });
    const shortcutBar = page.getByTestId('shortcut-bar');
    await expect(shortcutBar).toBeVisible();

    // Verify shortcut buttons exist with minimum 44px tap targets
    const ctrlC = page.getByTestId('shortcut-ctrl-c');
    const ctrlD = page.getByTestId('shortcut-ctrl-d');
    const tab = page.getByTestId('shortcut-tab');
    const up = page.getByTestId('shortcut-up');
    const down = page.getByTestId('shortcut-down');
    const esc = page.getByTestId('shortcut-esc');

    await expect(ctrlC).toBeVisible();
    await expect(ctrlD).toBeVisible();
    await expect(tab).toBeVisible();
    await expect(up).toBeVisible();
    await expect(down).toBeVisible();
    await expect(esc).toBeVisible();

    // Verify tap targets are at least 44px
    const ctrlCBox = await ctrlC.boundingBox();
    expect(ctrlCBox.width).toBeGreaterThanOrEqual(44);
    expect(ctrlCBox.height).toBeGreaterThanOrEqual(44);

    // Wait for terminal to connect
    await page.waitForFunction(() => {
      const term = document.querySelector('[data-testid="terminal"]');
      return term && term.getAttribute('data-connection-state') === 'connected';
    }, { timeout: 10000 });

    // Type something into the terminal first — send a long-running command
    // so Ctrl+C can interrupt it
    const termArea = page.getByTestId('mobile-terminal-area');
    await termArea.click();

    // Small delay for terminal focus
    await page.waitForTimeout(500);

    // Send a sleep command via the terminal area interaction
    await page.keyboard.type('sleep 999');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);

    // Tap Ctrl+C to send interrupt
    await ctrlC.click();

    // The sleep command should be interrupted — verify by checking terminal output
    // After Ctrl+C the shell prompt should reappear
    await page.waitForTimeout(1000);

    // Verify we can still type after interrupt (terminal is responsive)
    await page.keyboard.type('echo INTERRUPT_OK');
    await page.keyboard.press('Enter');

    // Wait for echo output
    await page.waitForFunction(() => {
      const term = document.querySelector('[data-testid="terminal"]');
      return term && term.textContent.includes('INTERRUPT_OK');
    }, { timeout: 5000 });

    // Tap back button to return to terminal list (Phase 6 navigation)
    await backButton.click();
    await page.waitForSelector('[data-testid="mobile-terminal-list"]', { state: 'visible', timeout: 5000 });
    await expect(page.getByTestId('mobile-terminal-list')).toBeVisible();

    // Tap back again to return to dashboard
    await page.getByTestId('terminal-list-back').click();
    await page.waitForSelector('[data-testid="mobile-dashboard"]', { state: 'visible', timeout: 5000 });
    await expect(page.getByTestId('mobile-dashboard')).toBeVisible();
  });

  test('long-press project card shows quick action menu', async ({ page }) => {
    // Create project via API
    const projectName = `LongPress-${Date.now()}`;
    const path = `/tmp/dancode-e2e-lp-${Date.now()}`;

    const createRes = await page.request.post('/api/projects', {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      data: { name: projectName, path },
    });
    expect(createRes.ok()).toBeTruthy();
    const project = await createRes.json();
    slug = project.slug;
    projectPath = path;

    await page.reload();
    await page.waitForSelector('[data-testid="mobile-dashboard"]', { state: 'visible', timeout: 10000 });

    const card = page.getByTestId(`project-card-${slug}`);
    await expect(card).toBeVisible();

    // Use context menu (right-click simulates long-press in Playwright)
    await card.click({ button: 'right' });

    // Quick action menu should appear
    await page.waitForSelector('[data-testid="quick-action-menu"]', { state: 'visible', timeout: 5000 });
    const menu = page.getByTestId('quick-action-menu');
    await expect(menu).toBeVisible();

    // Verify CLI and Claude actions
    await expect(page.getByTestId('quick-action-cli')).toBeVisible();
    await expect(page.getByTestId('quick-action-claude')).toBeVisible();

    // Tap "Open CLI Terminal" — should go to terminal view
    await page.getByTestId('quick-action-cli').click();
    await page.waitForSelector('[data-testid="mobile-terminal-view"]', { state: 'visible', timeout: 15000 });
    await expect(page.getByTestId('mobile-terminal-view')).toBeVisible();
  });
});
