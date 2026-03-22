import { test, expect } from '@playwright/test';

test('placeholder page displays DanCode heading', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('h1')).toHaveText('DanCode');
  await expect(page.locator('p')).toHaveText('Web-Based Project Terminal Manager');
});
