import { test, expect } from '@playwright/test';
import { login, createProject, cleanupProject } from './e2e-helpers.js';

const PROJECT_NAME = `Visual Terminal ${Date.now()}`;

/**
 * Visual assertion: "a terminal with a dark solarized color scheme fills the browser window"
 *
 * Verifies the three visual properties:
 *   1. A terminal element is present and rendered
 *   2. The color scheme is Solarized Dark (background #002b36)
 *   3. The terminal fills the browser window
 */
test.describe('Terminal visual', () => {
  let token;
  const created = [];

  test.afterEach(async ({ request }) => {
    for (const { slug, projectPath } of created) {
      await cleanupProject(request, slug, token, projectPath);
    }
  });

  test('visual: a terminal with a dark solarized color scheme fills the browser window', async ({ page }) => {
    token = await login(page);

    const proj = await createProject(page, PROJECT_NAME);
    created.push(proj);

    // Wait for a terminal pane with xterm to render
    const pane = page.getByTestId('terminal-pane-0');
    await expect(pane).toBeVisible({ timeout: 10000 });
    await expect(pane.locator('.xterm')).toBeVisible({ timeout: 10000 });

    // 1. Verify Solarized Dark color scheme via screenshot pixel analysis.
    const xtermScreen = pane.locator('.xterm-screen');
    const screenshot = await xtermScreen.screenshot({ type: 'png' });
    const base64 = screenshot.toString('base64');

    const pixelData = await page.evaluate(async (imgBase64) => {
      const img = new Image();
      img.src = `data:image/png;base64,${imgBase64}`;
      await new Promise((resolve) => { img.onload = resolve; });

      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);

      // Sample from the center of the terminal surface
      const cx = Math.floor(img.width / 2);
      const cy = Math.floor(img.height / 2);
      const [r, g, b] = ctx.getImageData(cx, cy, 1, 1).data;

      return { r, g, b };
    }, base64);

    // Solarized Dark base03 = #002b36 = RGB(0, 43, 54)
    // Allow ±5 tolerance for rendering differences
    const { r, g, b } = pixelData;
    expect(r).toBeLessThanOrEqual(5);
    expect(g).toBeGreaterThanOrEqual(38);
    expect(g).toBeLessThanOrEqual(48);
    expect(b).toBeGreaterThanOrEqual(49);
    expect(b).toBeLessThanOrEqual(59);

    // 2. Verify the rendered xterm surface fills a significant portion of the window.
    const metrics = await page.evaluate(() => {
      const screen = document.querySelector('[data-testid="terminal-pane-0"] .xterm-screen');
      const rect = screen.getBoundingClientRect();
      return {
        termWidth: rect.width,
        termHeight: rect.height,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      };
    });

    // Terminal surface should occupy a good portion of viewport
    // (sidebar and header take some space, plus there are 2 panes side by side)
    const widthRatio = metrics.termWidth / metrics.viewportWidth;
    const heightRatio = metrics.termHeight / metrics.viewportHeight;

    expect(widthRatio).toBeGreaterThanOrEqual(0.3);
    expect(heightRatio).toBeGreaterThanOrEqual(0.5);
  });
});
