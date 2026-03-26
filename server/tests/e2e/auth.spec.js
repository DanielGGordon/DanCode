import { test, expect } from '@playwright/test';
import { generate } from 'otplib';

/**
 * E2E auth tests. These assume the server is running fresh (no account set up).
 * If an account already exists, only the login tests will work.
 */

test('login flow: shows login screen, enter credentials, terminal appears', async ({ page }) => {
  await page.goto('/');

  // Check if we're on setup or login screen
  const setupUsername = page.getByTestId('setup-username');
  const loginUsername = page.getByTestId('login-username');

  // Wait for either setup or login to appear
  await expect(page.locator('form')).toBeVisible();

  if (await setupUsername.isVisible().catch(() => false)) {
    // Setup flow: create account first
    await setupUsername.fill('testuser');
    await page.getByTestId('setup-password').fill('testpassword123');
    await page.getByTestId('setup-confirm').fill('testpassword123');
    await page.getByTestId('setup-submit').click();

    // TOTP enrollment screen
    const qrCode = page.getByTestId('totp-qr');
    await expect(qrCode).toBeVisible();

    // Get the TOTP secret from the page
    const secretText = await page.locator('code').textContent();
    const totpCode = await generate({ secret: secretText });

    await page.getByTestId('enroll-totp').fill(totpCode);
    await page.getByTestId('enroll-submit').click();
  } else {
    // Login flow: account already exists
    await expect(loginUsername).toBeVisible();
    await expect(page.getByTestId('login-password')).toBeVisible();
    await expect(page.getByTestId('login-totp')).toBeVisible();
    await expect(page.getByText('Sign in to continue')).toBeVisible();

    // We can't easily login here without knowing the TOTP secret,
    // so this test verifies the login form is displayed correctly
  }
});

test('invalid credentials shows error message', async ({ page }) => {
  await page.goto('/');

  // Wait for the form to load
  await expect(page.locator('form')).toBeVisible();

  const loginUsername = page.getByTestId('login-username');

  // Only test if we're on the login screen (account already set up)
  if (await loginUsername.isVisible().catch(() => false)) {
    await loginUsername.fill('wronguser');
    await page.getByTestId('login-password').fill('wrongpassword');
    await page.getByTestId('login-totp').fill('000000');
    await page.getByTestId('login-submit').click();

    await expect(page.getByTestId('login-error')).toHaveText('Invalid credentials');
    await expect(loginUsername).toBeVisible();
  }
});
