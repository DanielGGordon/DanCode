import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { generate } from 'otplib';

/**
 * Phase 6 E2E: PWA + Mobile Dashboard
 *
 * Uses Playwright mobile emulation (Pixel 5 viewport) to test:
 * 1. Mobile dashboard shows project cards with activity indicators
 * 2. Tap project → see terminal list
 * 3. Tap terminal → full-screen terminal view
 * 4. Swipe between terminals (dot indicators)
 * 5. Back navigation (terminal → list → dashboard)
 * 6. PWA manifest served correctly
 */

// Pixel 5 viewport
const PIXEL_5 = { width: 393, height: 851 };

const TEST_USERNAME = 'testuser';
const TEST_PASSWORD = 'testpassword123';

/**
 * Mobile-aware login: same as e2e-helpers login but waits for
 * mobile-dashboard OR new-project-button depending on viewport.
 */
async function mobileLogin(page) {
  const statusRes = await page.request.get('/api/auth/setup/status');
  const { setupComplete } = await statusRes.json();

  let username, password, totpSecret;

  if (!setupComplete) {
    const setupRes = await page.request.post('/api/auth/setup', {
      data: { username: TEST_USERNAME, password: TEST_PASSWORD },
    });
    if (!setupRes.ok()) {
      throw new Error(`Account setup failed: ${setupRes.status()} ${await setupRes.text()}`);
    }
    const setupData = await setupRes.json();
    username = TEST_USERNAME;
    password = TEST_PASSWORD;
    totpSecret = setupData.totpSecret;
  } else {
    const credPath = join(homedir(), '.dancode', 'credentials.json');
    const creds = JSON.parse(await readFile(credPath, 'utf-8'));
    username = creds.username;
    totpSecret = creds.totpSecret;
    password = process.env.DANCODE_PASSWORD;
    if (!password) {
      try {
        const pwPath = join(homedir(), '.dancode', 'e2e-password');
        password = (await readFile(pwPath, 'utf-8')).trim();
      } catch {
        password = TEST_PASSWORD;
      }
    }
  }

  const totpCode = await generate({ secret: totpSecret });
  const response = await page.request.post('/api/auth/login', {
    data: { username, password, totpCode },
  });

  if (!response.ok()) {
    throw new Error(`Login failed: ${response.status()} ${await response.text()}`);
  }

  const { token } = await response.json();

  await page.goto('/');
  await page.evaluate((tok) => localStorage.setItem('dancode-auth-token', tok), token);
  await page.reload();

  // On mobile, wait for the mobile dashboard
  await page.waitForSelector('[data-testid="mobile-dashboard"]', { state: 'visible', timeout: 10000 });

  return token;
}

async function cleanupProject(request, slug, token, projectPath) {
  if (slug && token) {
    try {
      await request.delete(`/api/projects/${slug}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch { /* best-effort */ }
  }
  if (projectPath) {
    const { rm } = await import('node:fs/promises');
    try { await rm(projectPath, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
}

test.describe('PWA + Mobile Dashboard', () => {
  let token;
  let slug;
  let projectPath;

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(PIXEL_5);
    token = await mobileLogin(page);
  });

  test.afterEach(async ({ request }) => {
    if (slug && token) {
      await cleanupProject(request, slug, token, projectPath);
      slug = null;
      projectPath = null;
    }
  });

  test('manifest.json is served with correct PWA fields', async ({ page }) => {
    const res = await page.request.get('/manifest.json');
    expect(res.ok()).toBeTruthy();
    const manifest = await res.json();
    expect(manifest.name).toBe('DanCode');
    expect(manifest.theme_color).toBe('#002b36');
    expect(manifest.display).toBe('standalone');
    expect(manifest.icons.length).toBeGreaterThan(0);
  });

  test('shows mobile dashboard on Pixel 5 viewport', async ({ page }) => {
    const dashboard = page.getByTestId('mobile-dashboard');
    await expect(dashboard).toBeVisible();
    // Desktop layout should NOT be visible
    await expect(page.getByTestId('sidebar').first()).not.toBeVisible();
  });

  test('dashboard → terminal list → terminal view → back navigation', async ({ page }) => {
    // Create project via API
    const projectName = `PWA-${Date.now()}`;
    const path = `/tmp/dancode-e2e-pwa-${Date.now()}`;

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

    // Reload to see project in dashboard
    await page.reload();
    await page.waitForSelector('[data-testid="mobile-dashboard"]', { state: 'visible', timeout: 10000 });

    // Verify project card exists with activity indicator
    const card = page.getByTestId(`project-card-${slug}`);
    await expect(card).toBeVisible();
    const indicator = page.getByTestId(`activity-indicator-${slug}`);
    await expect(indicator).toBeVisible();

    // Tap project card → should show terminal list
    await card.click();
    await page.waitForSelector('[data-testid="mobile-terminal-list"]', { state: 'visible', timeout: 10000 });
    const termList = page.getByTestId('mobile-terminal-list');
    await expect(termList).toBeVisible();

    // Terminal list should show the project's terminals (CLI and Claude)
    // Wait for terminal items to appear
    await page.waitForFunction(() => {
      const items = document.querySelectorAll('[data-testid^="terminal-item-"]');
      return items.length >= 1;
    }, { timeout: 5000 });

    // Tap the first terminal → full-screen terminal view
    const firstTerminal = page.locator('[data-testid^="terminal-item-"]').first();
    await firstTerminal.click();
    await page.waitForSelector('[data-testid="mobile-terminal-view"]', { state: 'visible', timeout: 15000 });
    await expect(page.getByTestId('mobile-terminal-view')).toBeVisible();

    // Verify dot indicators (should show since project has CLI + Claude = 2 terminals)
    await expect(page.getByTestId('dot-indicators')).toBeVisible();
    await expect(page.getByTestId('dot-0')).toBeVisible();
    await expect(page.getByTestId('dot-1')).toBeVisible();

    // Active dot should be highlighted (dot-0)
    const dot0 = page.getByTestId('dot-0');
    const dot0Class = await dot0.getAttribute('class');
    expect(dot0Class).toContain('bg-blue');

    // Tap dot-1 to switch terminal
    await page.getByTestId('dot-1').click();
    await page.waitForTimeout(500);

    // Now dot-1 should be active
    const dot1Class = await page.getByTestId('dot-1').getAttribute('class');
    expect(dot1Class).toContain('bg-blue');

    // Back button → return to terminal list
    await page.getByTestId('mobile-back-button').click();
    await page.waitForSelector('[data-testid="mobile-terminal-list"]', { state: 'visible', timeout: 5000 });
    await expect(page.getByTestId('mobile-terminal-list')).toBeVisible();

    // Back button → return to dashboard
    await page.getByTestId('terminal-list-back').click();
    await page.waitForSelector('[data-testid="mobile-dashboard"]', { state: 'visible', timeout: 5000 });
    await expect(page.getByTestId('mobile-dashboard')).toBeVisible();
  });

  test('lastActivity timestamp is included in terminal API response', async ({ page }) => {
    // Create project
    const projectName = `Activity-${Date.now()}`;
    const path = `/tmp/dancode-e2e-act-${Date.now()}`;

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

    // Query terminals API
    const termRes = await page.request.get(`/api/terminals?project=${slug}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(termRes.ok()).toBeTruthy();
    const terminals = await termRes.json();
    expect(terminals.length).toBeGreaterThan(0);
    for (const t of terminals) {
      expect(t.lastActivity).toBeDefined();
      expect(new Date(t.lastActivity).getTime()).toBeGreaterThan(0);
    }
  });

  test('swipe between terminals via dots', async ({ page }) => {
    const projectName = `Swipe-${Date.now()}`;
    const path = `/tmp/dancode-e2e-swipe-${Date.now()}`;

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

    // Tap project → terminal list → first terminal
    await page.getByTestId(`project-card-${slug}`).click();
    await page.waitForSelector('[data-testid="mobile-terminal-list"]', { state: 'visible', timeout: 10000 });
    await page.locator('[data-testid^="terminal-item-"]').first().click();
    await page.waitForSelector('[data-testid="mobile-terminal-view"]', { state: 'visible', timeout: 15000 });

    // Should have dot indicators
    await expect(page.getByTestId('dot-indicators')).toBeVisible();

    // Swipe gesture: simulate swipe left (next terminal)
    const termArea = page.getByTestId('mobile-terminal-view');
    const box = await termArea.boundingBox();
    await page.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2, { steps: 10 });
    await page.mouse.up();

    // After swipe, dot-1 should be active
    await page.waitForTimeout(500);
    const dot1 = await page.getByTestId('dot-1').getAttribute('class');
    expect(dot1).toContain('bg-blue');
  });
});
