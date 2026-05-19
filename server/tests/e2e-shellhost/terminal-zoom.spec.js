import { test, expect } from '@playwright/test';
import { login, createProject, cleanupProject } from '../e2e/e2e-helpers.js';

/**
 * Phase 2 acceptance E2E: per-terminal Ctrl+= zoom.
 *
 *   1. Open a project (auto-creates two terminals).
 *   2. Focus terminal 0, press Ctrl+= one step (default 13 -> 14).
 *   3. Type `echo hi` and confirm output renders at the new size.
 *   4. Switch to terminal 1 and confirm its xterm.options.fontSize is still
 *      the default 13.
 *   5. Reload the page; confirm the zoomed terminal restored its size and the
 *      other terminal is still at default.
 */
test.describe('Per-terminal zoom (Ctrl+= persists per id, leaves others alone)', () => {
  let token;
  const created = [];

  test.afterEach(async ({ request }) => {
    for (const { slug, projectPath } of created) {
      await cleanupProject(request, slug, token, projectPath);
    }
    created.length = 0;
  });

  test('zoom one terminal, switch to another, reload, persist', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    token = await login(page);

    const proj = await createProject(page, `Zoom ${Date.now()}`);
    created.push(proj);

    // Two terminals are auto-created (CLI + Claude).
    const pane0 = page.getByTestId('terminal-pane-0');
    const pane1 = page.getByTestId('terminal-pane-1');
    await expect(pane0).toBeVisible({ timeout: 15000 });
    await expect(pane1).toBeVisible({ timeout: 15000 });
    await expect(pane0.locator('.xterm')).toBeVisible({ timeout: 15000 });
    await expect(pane1.locator('.xterm')).toBeVisible({ timeout: 15000 });

    const term0Id = await pane0.locator('[data-testid="terminal"]').getAttribute('data-terminal-id');
    const term1Id = await pane1.locator('[data-testid="terminal"]').getAttribute('data-terminal-id');
    expect(term0Id).toMatch(/^[a-f0-9-]{36}$/);
    expect(term1Id).toMatch(/^[a-f0-9-]{36}$/);
    expect(term0Id).not.toBe(term1Id);

    // Both terminals should start at the configured default font size (13).
    expect(await readFontSize(page, term0Id)).toBe(13);
    expect(await readFontSize(page, term1Id)).toBe(13);

    // Focus terminal 0 and press Ctrl+= twice → 13 -> 14 -> 15.
    const helper0 = pane0.locator('textarea.xterm-helper-textarea');
    await helper0.waitFor({ state: 'attached', timeout: 10000 });
    await helper0.focus();
    await page.waitForTimeout(200);

    await page.keyboard.press('Control+=');
    await page.keyboard.press('Control+=');

    await expect.poll(() => readFontSize(page, term0Id), { timeout: 5000 }).toBe(15);

    // Type `echo hi` and confirm output renders at the new size.
    await helper0.focus();
    await page.keyboard.type('echo hi');
    await page.keyboard.press('Enter');
    await expect.poll(
      async () => (await pane0.locator('.xterm').innerText()).includes('hi'),
      { timeout: 15000 },
    ).toBe(true);

    // Terminal 1 must still be at the default size — Ctrl+= on terminal 0
    // should not leak to other panes.
    expect(await readFontSize(page, term1Id)).toBe(13);

    // localStorage holds the persisted entry under the per-id key.
    const stored = await page.evaluate(
      (id) => localStorage.getItem('dancode-zoom-terminal:' + id),
      term0Id,
    );
    expect(stored).toBe('15');

    // Ctrl+0 resets to the default.
    await helper0.focus();
    await page.keyboard.press('Control+0');
    await expect.poll(() => readFontSize(page, term0Id), { timeout: 3000 }).toBe(13);

    // Zoom back to 17 so reload-restore has something to verify.
    await helper0.focus();
    for (let i = 0; i < 4; i++) await page.keyboard.press('Control+=');
    await expect.poll(() => readFontSize(page, term0Id), { timeout: 3000 }).toBe(17);

    // --- Reload and verify persistence. ---
    await page.reload();
    await reopenProject(page, proj.slug);

    const paneAfter0 = page.getByTestId('terminal-pane-0');
    const paneAfter1 = page.getByTestId('terminal-pane-1');
    await expect(paneAfter0).toBeVisible({ timeout: 15000 });
    await expect(paneAfter1).toBeVisible({ timeout: 15000 });
    await expect(paneAfter0.locator('.xterm')).toBeVisible({ timeout: 15000 });
    await expect(paneAfter1.locator('.xterm')).toBeVisible({ timeout: 15000 });

    // Same terminal ids → restored zoom for term0, default for term1.
    await expect.poll(() => readFontSize(page, term0Id), { timeout: 10000 }).toBe(17);
    expect(await readFontSize(page, term1Id)).toBe(13);
  });
});

async function reopenProject(page, slug) {
  const sidebarEntry = page.getByTestId(`sidebar-project-${slug}`);
  await sidebarEntry.waitFor({ state: 'visible', timeout: 15000 });
  await sidebarEntry.click();
}

async function readFontSize(page, terminalId) {
  return page.evaluate((tid) => {
    const map = window.__dancodeTerminals;
    const term = map && map.get(tid);
    return term ? term.options.fontSize : null;
  }, terminalId);
}
