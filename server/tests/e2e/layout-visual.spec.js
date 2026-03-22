import { test, expect } from '@playwright/test';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const PROJECT_NAME = `Layout Visual ${Date.now()}`;

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Visual assertion: "two terminal panes are displayed side by side with labels,
 * on a dark solarized background"
 *
 * Uses programmatic visual verification (like terminal-visual.spec.js) because
 * phi3.5 (3.7 GiB) cannot load alongside Chromium + test servers on Pi 5.
 *
 * Verifies:
 *   1. Exactly two pane containers are visible in a horizontal flex row
 *   2. Each pane has a label header (CLI, Claude)
 *   3. The background is Solarized Dark (#002b36)
 *   4. The panes are positioned side by side (non-overlapping, similar widths)
 */
test('visual: two terminal panes displayed side by side with labels on dark solarized background', async ({ page }) => {
  let slug, token, projectPath;

  try {
    await page.setViewportSize({ width: 1280, height: 720 });

    // Login
    const tokenPath = join(homedir(), '.dancode', 'auth-token');
    token = (await readFile(tokenPath, 'utf-8')).trim();
    await page.goto('/');
    const tokenInput = page.getByTestId('token-input');
    await expect(tokenInput).toBeVisible();
    await tokenInput.fill(token);
    await page.getByTestId('login-submit').click();
    await expect(page.getByTestId('new-project-button')).toBeVisible();

    // Create project
    slug = slugify(PROJECT_NAME);
    projectPath = `/tmp/dancode-layout-visual-${Date.now()}`;
    await page.getByTestId('new-project-button').click();
    await expect(page.getByTestId('new-project-form')).toBeVisible();
    await page.getByTestId('project-name-input').fill(PROJECT_NAME);
    const pathInput = page.getByTestId('project-path-input');
    await pathInput.clear();
    await pathInput.fill(projectPath);
    await page.getByTestId('new-project-submit').click();
    await expect(page.getByTestId('pane-layout')).toBeVisible({ timeout: 15000 });

    // Hide the Ralph pane so exactly two panes are displayed
    await page.getByTestId('visibility-2').click();
    await expect(page.getByTestId('pane-2')).not.toBeVisible();
    await expect(page.getByTestId('pane-0')).toBeVisible();
    await expect(page.getByTestId('pane-1')).toBeVisible();

    // Wait for terminals to render
    const pane0 = page.getByTestId('pane-0');
    const pane1 = page.getByTestId('pane-1');
    await expect(pane0.locator('.xterm')).toBeVisible({ timeout: 10000 });
    await expect(pane1.locator('.xterm')).toBeVisible({ timeout: 10000 });

    // 1. Verify exactly two visible panes positioned side by side
    const layout = await page.evaluate(() => {
      const panes = [
        document.querySelector('[data-testid="pane-0"]'),
        document.querySelector('[data-testid="pane-1"]'),
      ];
      const rects = panes.map((p) => p.getBoundingClientRect());
      const hidden2 = document.querySelector('[data-testid="pane-2"]');
      const pane2Hidden = hidden2
        ? hidden2.classList.contains('hidden') || getComputedStyle(hidden2).display === 'none'
        : true;

      return {
        pane0: { left: rects[0].left, right: rects[0].right, width: rects[0].width, top: rects[0].top },
        pane1: { left: rects[1].left, right: rects[1].right, width: rects[1].width, top: rects[1].top },
        pane2Hidden,
        viewportWidth: window.innerWidth,
      };
    });

    // Third pane must be hidden
    expect(layout.pane2Hidden).toBe(true);

    // Panes are side by side: pane1 starts at or after where pane0 ends
    expect(layout.pane1.left).toBeGreaterThanOrEqual(layout.pane0.right - 2);

    // Panes are on the same row (similar top positions)
    expect(Math.abs(layout.pane0.top - layout.pane1.top)).toBeLessThanOrEqual(2);

    // Each pane occupies roughly half the viewport (40-60%)
    const widthRatio0 = layout.pane0.width / layout.viewportWidth;
    const widthRatio1 = layout.pane1.width / layout.viewportWidth;
    expect(widthRatio0).toBeGreaterThanOrEqual(0.4);
    expect(widthRatio0).toBeLessThanOrEqual(0.6);
    expect(widthRatio1).toBeGreaterThanOrEqual(0.4);
    expect(widthRatio1).toBeLessThanOrEqual(0.6);

    // 2. Verify labels are present
    const labels = await page.evaluate(() => {
      const pane0Label = document.querySelector('[data-testid="pane-0"]')
        ?.querySelector('div')?.textContent?.trim();
      const pane1Label = document.querySelector('[data-testid="pane-1"]')
        ?.querySelector('div')?.textContent?.trim();
      return { pane0Label, pane1Label };
    });

    expect(labels.pane0Label).toBe('CLI');
    expect(labels.pane1Label).toBe('Claude');

    // 3. Verify Solarized Dark background (#002b36) via screenshot pixel analysis
    const screenshot = await page.screenshot({ type: 'png' });
    const base64 = screenshot.toString('base64');

    const bgColor = await page.evaluate(async (imgBase64) => {
      const img = new Image();
      img.src = `data:image/png;base64,${imgBase64}`;
      await new Promise((resolve) => { img.onload = resolve; });

      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);

      // Sample from top-left area (toolbar/header background)
      const [r, g, b] = ctx.getImageData(10, 10, 1, 1).data;
      return { r, g, b };
    }, base64);

    // Solarized Dark base03 = #002b36 = RGB(0, 43, 54)
    // base02 = #073642 = RGB(7, 54, 66) (used for toolbar)
    // Allow ±10 tolerance for either shade
    expect(bgColor.r).toBeLessThanOrEqual(17);
    expect(bgColor.g).toBeGreaterThanOrEqual(33);
    expect(bgColor.g).toBeLessThanOrEqual(64);
    expect(bgColor.b).toBeGreaterThanOrEqual(44);
    expect(bgColor.b).toBeLessThanOrEqual(76);
  } finally {
    if (slug && token) {
      try {
        await page.request.delete(`/api/projects/${slug}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch { /* best-effort */ }

      try {
        await execFileAsync('tmux', ['kill-session', '-t', `dancode-${slug}`]);
      } catch { /* session may not exist */ }
    }

    if (projectPath) {
      try {
        await rm(projectPath, { recursive: true, force: true });
      } catch { /* best-effort */ }
    }
  }
});
