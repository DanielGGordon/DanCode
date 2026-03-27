import { test, expect } from '@playwright/test';
import { login } from './e2e-helpers.js';

/**
 * Visual assertion: "a new project form is displayed with name and path input fields on a dark background"
 */

test('new project form passes visual assertion', async ({ page }) => {
  await login(page);

  // Click "New Project" to show the form
  await page.getByTestId('new-project-button').click();
  const form = page.getByTestId('new-project-form');
  await expect(form).toBeVisible();

  // 1. Verify form has the expected input fields
  const nameInput = page.getByTestId('project-name-input');
  const pathInput = page.getByTestId('project-path-input');
  await expect(nameInput).toBeVisible();
  await expect(pathInput).toBeVisible();

  // Verify heading
  const heading = form.locator('h2');
  await expect(heading).toContainText('New Project');

  // Verify submit and cancel buttons
  const submitButton = page.getByTestId('new-project-submit');
  const cancelButton = page.getByTestId('new-project-cancel');
  await expect(submitButton).toBeVisible();
  await expect(cancelButton).toBeVisible();

  // 2. Verify form is centered within its container
  const layout = await page.evaluate(() => {
    const form = document.querySelector('[data-testid="new-project-form"]');
    const rect = form.getBoundingClientRect();
    const parent = form.closest('main') || form.parentElement;
    const parentRect = parent.getBoundingClientRect();
    return {
      formCenterX: rect.left + rect.width / 2,
      parentCenterX: parentRect.left + parentRect.width / 2,
      formCenterY: rect.top + rect.height / 2,
      parentCenterY: parentRect.top + parentRect.height / 2,
    };
  });

  const xOffset = Math.abs(layout.formCenterX - layout.parentCenterX);
  const yOffset = Math.abs(layout.formCenterY - layout.parentCenterY);
  expect(xOffset).toBeLessThanOrEqual(50);
  expect(yOffset).toBeLessThanOrEqual(50);

  // 3. Verify dark background
  const bgColor = await page.evaluate(() => {
    const wrapper = document.querySelector('[data-testid="new-project-form"]').parentElement;
    return window.getComputedStyle(wrapper).backgroundColor;
  });

  const match = bgColor.match(/(\d+),\s*(\d+),\s*(\d+)/);
  expect(match).not.toBeNull();
  const [, r, g, b] = match.map(Number);
  // base03 = #002b36 = RGB(0, 43, 54)
  expect(r).toBeLessThanOrEqual(10);
  expect(g).toBeLessThanOrEqual(60);
  expect(b).toBeLessThanOrEqual(70);
});
