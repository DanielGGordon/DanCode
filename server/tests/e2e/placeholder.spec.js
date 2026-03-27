import { test, expect } from '@playwright/test';

test('root page displays DanCode login screen', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('h1').first()).toHaveText('DanCode');
  await expect(page.locator('p').first()).toHaveText('Sign in to continue');
});
