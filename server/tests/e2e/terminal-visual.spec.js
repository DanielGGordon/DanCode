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

  // 1. Verify Solarized Dark color scheme via screenshot pixel analysis.
  //    Screenshot the .xterm-screen element (the rendered terminal surface),
  //    not the full page — the page background is also #002b36, so a page-level
  //    sample would pass even if the terminal theme is broken or unpainted.
  const xtermScreen = terminal.locator('.xterm-screen');
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

  // 2. Verify the rendered xterm surface fills the browser window.
  //    Measure .xterm-screen (the actual terminal surface sized by fitAddon),
  //    not the outer [data-testid="terminal"] container which fills the layout
  //    via CSS regardless of whether fitAddon.fit() worked correctly.
  const metrics = await page.evaluate(() => {
    const screen = document.querySelector('[data-testid="terminal"] .xterm-screen');
    const rect = screen.getBoundingClientRect();
    return {
      termWidth: rect.width,
      termHeight: rect.height,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    };
  });

  // Terminal surface should occupy at least 90% of viewport width and 80% of height
  // (allowing for a header bar)
  const widthRatio = metrics.termWidth / metrics.viewportWidth;
  const heightRatio = metrics.termHeight / metrics.viewportHeight;

  expect(widthRatio).toBeGreaterThanOrEqual(0.9);
  expect(heightRatio).toBeGreaterThanOrEqual(0.8);
});
