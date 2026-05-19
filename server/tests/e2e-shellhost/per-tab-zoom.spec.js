import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { login, createProject, cleanupProject } from '../e2e/e2e-helpers.js';

/**
 * Phase 1 acceptance E2E: per-file-tab zoom.
 *
 * Opens two file tabs in the same project, zooms one of them in three
 * times, switches tabs, switches back, and asserts:
 *   - the zoomed tab's CodeMirror content uses a larger computed font-size
 *   - the un-zoomed tab is still at the default size
 *   - reloading the page restores both sizes (zoomed and default)
 */

test.describe('Phase 1: per-tab file zoom', () => {
  let token;
  const created = [];

  test.afterEach(async ({ request }) => {
    for (const { slug, projectPath } of created) {
      await cleanupProject(request, slug, token, projectPath);
    }
    created.length = 0;
  });

  test('zoom is isolated per tab and persists across reload', async ({ page, request }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1280, height: 720 });

    token = await login(page);
    const proj = await createProject(page, `Zoom ${Date.now()}`);
    created.push(proj);

    // Seed two distinct fixture files.
    await writeFile(join(proj.projectPath, 'a.js'), 'const a = 1\n');
    await writeFile(join(proj.projectPath, 'b.js'), 'const b = 2\n');

    // Open both as panes via the layout API; reloading is the same code path
    // the file explorer click eventually exercises.
    await openTwoFiles(page, request, token, proj.slug, ['a.js', 'b.js']);

    // Read the default size from the first editor before we zoom.
    const firstViewer = page.locator('[data-testid="file-viewer"]').first();
    const secondViewer = page.locator('[data-testid="file-viewer"]').nth(1);
    await expect(firstViewer).toBeVisible({ timeout: 15000 });
    await expect(secondViewer).toBeVisible({ timeout: 15000 });

    const defaultSize = await getFontSize(firstViewer);
    expect(defaultSize).toBeGreaterThan(0);

    // Focus the first editor and zoom in three times.
    await firstViewer.locator('.cm-content').click();
    await page.keyboard.press('Control+=');
    await page.keyboard.press('Control+=');
    await page.keyboard.press('Control+=');

    // First editor grew by 3 px, second editor is unchanged.
    await expect.poll(() => getFontSize(firstViewer), { timeout: 5000 }).toBe(defaultSize + 3);
    expect(await getFontSize(secondViewer)).toBe(defaultSize);

    // Click into the second editor — its size remains default.
    await secondViewer.locator('.cm-content').click();
    expect(await getFontSize(secondViewer)).toBe(defaultSize);

    // Back to the first — still 3 steps up.
    await firstViewer.locator('.cm-content').click();
    expect(await getFontSize(firstViewer)).toBe(defaultSize + 3);

    // Press Ctrl+0 on the first to reset, then bump it back up by two.
    await firstViewer.locator('.cm-content').click();
    await page.keyboard.press('Control+0');
    await expect.poll(() => getFontSize(firstViewer), { timeout: 5000 }).toBe(defaultSize);
    await page.keyboard.press('Control+=');
    await page.keyboard.press('Control+=');
    await expect.poll(() => getFontSize(firstViewer), { timeout: 5000 }).toBe(defaultSize + 2);

    // Reload — the zoom for `a.js` must survive, `b.js` must still be default.
    await page.reload();
    await reopenProjectIfNeeded(page, proj.slug);

    const firstAfter = page.locator('[data-testid="file-viewer"]').first();
    const secondAfter = page.locator('[data-testid="file-viewer"]').nth(1);
    await expect(firstAfter).toBeVisible({ timeout: 15000 });
    await expect(secondAfter).toBeVisible({ timeout: 15000 });

    await expect.poll(() => getFontSize(firstAfter), { timeout: 10000 }).toBe(defaultSize + 2);
    expect(await getFontSize(secondAfter)).toBe(defaultSize);
  });

  test('Ctrl+- decreases and clamps at the configured minimum', async ({ page, request }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1280, height: 720 });

    token = await login(page);
    const proj = await createProject(page, `ZoomMin ${Date.now()}`);
    created.push(proj);

    await writeFile(join(proj.projectPath, 'shrink.js'), 'const z = 0\n');
    await openTwoFiles(page, request, token, proj.slug, ['shrink.js']);

    const viewer = page.locator('[data-testid="file-viewer"]').first();
    await expect(viewer).toBeVisible({ timeout: 15000 });

    const defaultSize = await getFontSize(viewer);
    expect(defaultSize).toBeGreaterThanOrEqual(8);

    await viewer.locator('.cm-content').click();
    // Press Ctrl+- well past the minimum (default 14, min 8, so ≥ 6 presses
    // would reach 8; we press 30 to prove clamping).
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press('Control+-');
    }

    const finalSize = await getFontSize(viewer);
    expect(finalSize).toBe(8);
  });
});

/**
 * Use the layout API to put the requested files into `openFiles`, then
 * reload so the FileViewer panes mount.
 */
async function openTwoFiles(page, request, token, slug, files) {
  const layoutRes = await request.get(`/api/projects/${slug}/layout`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const existing = layoutRes.ok() ? await layoutRes.json() : {};
  const layout = {
    terminals: Array.isArray(existing.terminals) ? existing.terminals : [],
    openFiles: files.map((f, i) => ({ path: f, pane: `p-${i}`, scrollTop: 0 })),
    splits: existing.splits || { type: 'leaf', id: 'root' },
    focusedPane: 'p-0',
  };
  await request.put(`/api/projects/${slug}/layout`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: layout,
  });
  await page.reload();
  await reopenProjectIfNeeded(page, slug);
}

async function reopenProjectIfNeeded(page, slug) {
  try {
    await page.waitForSelector('[data-testid="terminal-layout"]', { timeout: 3000 });
    return;
  } catch {
    /* fall through and pick from sidebar */
  }
  const entry = page.getByTestId(`sidebar-project-${slug}`);
  await entry.waitFor({ state: 'visible', timeout: 15000 });
  await entry.click();
  await page.waitForSelector('[data-testid="terminal-layout"]', { timeout: 15000 });
}

/**
 * Read the computed font-size (in pixels, as an integer) of an editor's
 * .cm-content node. CodeMirror applies the size via a generated stylesheet
 * registered with EditorView.theme, so getComputedStyle is the authoritative
 * source.
 */
async function getFontSize(viewerLocator) {
  const content = viewerLocator.locator('.cm-content');
  await content.waitFor({ state: 'visible', timeout: 15000 });
  const px = await content.evaluate((el) => {
    const cs = getComputedStyle(el);
    return Math.round(parseFloat(cs.fontSize));
  });
  return px;
}
