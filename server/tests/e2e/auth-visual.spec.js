import { test, expect } from '@playwright/test';

/**
 * Visual assertion: "a centered login form with a token input field on a dark background"
 *
 * Uses programmatic visual verification because no local vision model
 * runs reliably on Pi 5 ARM64 (phi3.5 needs 3.7 GiB, only ~2.5 GiB available).
 *
 * Verifies:
 *   1. A login form is visible with a token input and submit button
 *   2. The form is centered on the page
 *   3. The background is Solarized Dark (#002b36)
 */
test('login screen passes visual assertion', async ({ page }) => {
  await page.goto('/');

  // 1. Wait for the login form elements to be visible
  const tokenInput = page.getByTestId('token-input');
  await expect(tokenInput).toBeVisible();

  const submitButton = page.getByTestId('login-submit');
  await expect(submitButton).toBeVisible();
  await expect(submitButton).toContainText('Sign In');

  // Verify heading
  const heading = page.locator('h1');
  await expect(heading).toBeVisible();
  await expect(heading).toContainText('DanCode');

  // 2. Verify the form is centered on the page
  const layout = await page.evaluate(() => {
    const form = document.querySelector('form');
    const rect = form.getBoundingClientRect();
    return {
      formCenterX: rect.left + rect.width / 2,
      formCenterY: rect.top + rect.height / 2,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    };
  });

  // Form center should be within 10% of viewport center
  const xOffset = Math.abs(layout.formCenterX - layout.viewportWidth / 2) / layout.viewportWidth;
  const yOffset = Math.abs(layout.formCenterY - layout.viewportHeight / 2) / layout.viewportHeight;
  expect(xOffset).toBeLessThanOrEqual(0.1);
  expect(yOffset).toBeLessThanOrEqual(0.1);

  // 3. Verify dark background (Solarized Dark base03 = #002b36)
  const bgColor = await page.evaluate(() => {
    // The outermost wrapper div has bg-base03
    const wrapper = document.querySelector('form').parentElement;
    return window.getComputedStyle(wrapper).backgroundColor;
  });

  const match = bgColor.match(/(\d+),\s*(\d+),\s*(\d+)/);
  expect(match).not.toBeNull();
  const [, r, g, b] = match.map(Number);
  expect(r).toBeLessThanOrEqual(10);
  expect(g).toBeLessThanOrEqual(60);
  expect(b).toBeLessThanOrEqual(70);
});
