import { test, expect } from '@playwright/test';

/**
 * Visual assertion: "a page with the heading DanCode is displayed on a dark background"
 *
 * Uses programmatic visual verification because no local vision model
 * runs reliably on Pi 5 ARM64 (phi3.5 needs 3.7 GiB, only ~2.5 GiB available).
 *
 * Verifies:
 *   1. The page loads successfully
 *   2. A heading with "DanCode" is visible
 *   3. The background is Solarized Dark (#002b36)
 */
test('placeholder page passes visual assertion', async ({ page }) => {
  await page.goto('/');

  // 1. Verify the page has a heading with "DanCode"
  const heading = page.locator('h1');
  await expect(heading).toBeVisible();
  await expect(heading).toContainText('DanCode');

  // 2. Verify dark background (Solarized Dark base03 = #002b36)
  const bgColor = await page.evaluate(() => {
    const body = document.querySelector('body');
    return window.getComputedStyle(body).backgroundColor;
  });

  // Parse RGB and verify dark solarized palette
  const match = bgColor.match(/(\d+),\s*(\d+),\s*(\d+)/);
  expect(match).not.toBeNull();
  const [, r, g, b] = match.map(Number);
  // base03 = #002b36 = RGB(0, 43, 54) — allow tolerance for rendering
  expect(r).toBeLessThanOrEqual(10);
  expect(g).toBeLessThanOrEqual(60);
  expect(b).toBeLessThanOrEqual(70);
});
