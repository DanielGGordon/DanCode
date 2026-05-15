import { test, expect } from '@playwright/test';
import { login, createProject, cleanupProject } from '../e2e/e2e-helpers.js';

/**
 * Phase 1 acceptance E2E: open the app → log in → create a project → drive a
 * terminal end-to-end through the new shellhost backend.
 *
 * - Asserts `printf hello\n` typed via xterm appears in the terminal DOM.
 * - Pastes a fixture string via clipboard → Ctrl+V and asserts it appears
 *   exactly once (no double-paste).
 */
test.describe('Shellhost-backed terminal', () => {
  let token;
  const created = [];

  test.afterEach(async ({ request }) => {
    for (const { slug, projectPath } of created) {
      await cleanupProject(request, slug, token, projectPath);
    }
    created.length = 0;
  });

  test('typed input round-trips and clipboard paste lands exactly once', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.setViewportSize({ width: 1280, height: 720 });

    token = await login(page);

    const proj = await createProject(page, `Shellhost ${Date.now()}`);
    created.push(proj);

    const pane0 = page.getByTestId('terminal-pane-0');
    await expect(pane0).toBeVisible({ timeout: 15000 });
    await expect(pane0.locator('.xterm')).toBeVisible({ timeout: 15000 });

    // Focus the terminal by clicking inside it.
    await pane0.locator('.xterm').click();
    await page.waitForTimeout(500);

    // Send `printf hello\n` and assert "hello" appears in the rendered DOM.
    await page.keyboard.type('printf hello\\n');
    await page.keyboard.press('Enter');

    await expect(async () => {
      const text = await pane0.locator('.xterm').innerText();
      expect(text).toContain('hello');
    }).toPass({ timeout: 15000 });

    // Seed the clipboard with a fixture string.
    const PASTE_FIXTURE = `pasteCheck_${Math.random().toString(36).slice(2, 10)}`;
    await page.evaluate(async (val) => {
      await navigator.clipboard.writeText(val);
    }, PASTE_FIXTURE);

    // Press a NEWLINE first to put us on a fresh line.
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);

    // Mark current state so we can count occurrences strictly inside the
    // post-paste window.
    const beforeText = await pane0.locator('.xterm').innerText();
    const beforeCount = countOccurrences(beforeText, PASTE_FIXTURE);

    // Paste via Ctrl+V.
    await page.keyboard.press('Control+V');
    await page.waitForTimeout(800);

    // Assert paste landed.
    await expect(async () => {
      const t = await pane0.locator('.xterm').innerText();
      expect(t).toContain(PASTE_FIXTURE);
    }).toPass({ timeout: 5000 });

    // Allow a beat for any duplicate paste to surface, then count.
    await page.waitForTimeout(800);
    const afterText = await pane0.locator('.xterm').innerText();
    const afterCount = countOccurrences(afterText, PASTE_FIXTURE);

    // The DOM may also contain the value once if the shell echo prints it.
    // What we really care about is that paste itself did not duplicate the
    // input: the difference between before-paste and after-paste should be
    // exactly 1 (the single insertion).
    expect(afterCount - beforeCount).toBe(1);
  });
});

function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  let i = 0, count = 0;
  while ((i = haystack.indexOf(needle, i)) !== -1) {
    count++;
    i += needle.length;
  }
  return count;
}
