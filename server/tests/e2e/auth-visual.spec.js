import { test, expect } from './fixture.js';

test('login screen passes visual assertion', async ({ page, aiAssert }) => {
  await page.goto('/');

  // Wait for the login form to be visible before asserting
  await expect(page.getByTestId('token-input')).toBeVisible();

  await aiAssert('a centered login form with a token input field on a dark background', undefined, {
    domIncluded: true,
    screenshotIncluded: false,
  });
});
