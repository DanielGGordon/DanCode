import { test, expect } from './fixture.js';

test('placeholder page passes visual assertion', async ({ page, aiAssert }) => {
  await page.goto('/');
  await aiAssert('a page with the heading DanCode and subtitle Web-Based Project Terminal Manager is displayed', undefined, {
    domIncluded: true,
    screenshotIncluded: false,
  });
});
