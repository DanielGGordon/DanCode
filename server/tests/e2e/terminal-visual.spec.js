import { test, expect } from '@playwright/test';

/**
 * Visual assertion: "a terminal with a dark solarized color scheme fills the browser window"
 *
 * Verifies the three visual properties that aiAssert would check:
 *   1. A terminal element is present and rendered
 *   2. The color scheme is Solarized Dark (background #002b36)
 *   3. The terminal fills the browser window
 *
 * Uses programmatic visual verification because no local vision model
 * runs reliably on Pi 5 ARM64 (moondream crashes, qwen2.5vl needs 10GB+).
 */
test('visual: a terminal with a dark solarized color scheme fills the browser window', async ({ page }) => {
  await page.goto('/');

  const terminal = page.getByTestId('terminal');
  await expect(terminal).toBeVisible();
  await expect(terminal.locator('.xterm')).toBeVisible();

  // 1. Verify Solarized Dark color scheme via screenshot pixel analysis
  //    xterm.js renders to canvas/WebGL, so CSS computed styles won't show
  //    the theme — we must sample actual rendered pixels.
  const screenshot = await page.screenshot({ type: 'png' });
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

    // Sample background pixel from center of the page
    const cx = Math.floor(img.width / 2);
    const cy = Math.floor(img.height / 2);
    const [r, g, b] = ctx.getImageData(cx, cy, 1, 1).data;

    // Also sample a corner pixel (should be page background or terminal)
    const [cr, cg, cb] = ctx.getImageData(10, 10, 1, 1).data;

    return { center: { r, g, b }, corner: { r: cr, g: cg, b: cb } };
  }, base64);

  // Solarized Dark base03 = #002b36 = RGB(0, 43, 54)
  // Allow ±5 tolerance for rendering differences
  const { r, g, b } = pixelData.center;
  expect(r).toBeLessThanOrEqual(5);
  expect(g).toBeGreaterThanOrEqual(38);
  expect(g).toBeLessThanOrEqual(48);
  expect(b).toBeGreaterThanOrEqual(49);
  expect(b).toBeLessThanOrEqual(59);

  // 2. Verify terminal fills the browser window
  const metrics = await page.evaluate(() => {
    const termEl = document.querySelector('[data-testid="terminal"]');
    const rect = termEl.getBoundingClientRect();
    return {
      termWidth: rect.width,
      termHeight: rect.height,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    };
  });

  // Terminal should occupy at least 90% of viewport width and 80% of height
  // (allowing for a header bar)
  const widthRatio = metrics.termWidth / metrics.viewportWidth;
  const heightRatio = metrics.termHeight / metrics.viewportHeight;

  expect(widthRatio).toBeGreaterThanOrEqual(0.9);
  expect(heightRatio).toBeGreaterThanOrEqual(0.8);
});
