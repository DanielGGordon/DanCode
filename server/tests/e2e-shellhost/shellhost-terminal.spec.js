import { test, expect } from '@playwright/test';
import { login, createProject, cleanupProject } from '../e2e/e2e-helpers.js';

/**
 * Phase 1 acceptance E2E: open the app → log in → create a project → drive a
 * terminal end-to-end through the new shellhost backend.
 *
 * - Asserts `printf hello\n` typed via xterm appears in the terminal DOM.
 * - Pastes a fixture string via a synthetic ClipboardEvent + Ctrl+V and
 *   asserts it appears exactly once (no double-paste).
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

    // Focus xterm's hidden helper textarea explicitly. Clicking `.xterm` may
    // focus the wrapping div instead, which Playwright's Ctrl+V dispatches a
    // `paste` event to — but xterm's textarea is the element that actually
    // listens for paste. Without this focus step the fixture never lands.
    const helperTextarea = pane0.locator('textarea.xterm-helper-textarea');
    await helperTextarea.waitFor({ state: 'attached', timeout: 10000 });
    await helperTextarea.focus();
    await page.waitForTimeout(300);

    // Send `printf hello\n` and assert "hello" appears in the rendered DOM.
    await page.keyboard.type('printf hello\\n');
    await page.keyboard.press('Enter');

    await expect(async () => {
      const text = await pane0.locator('.xterm').innerText();
      expect(text).toContain('hello');
    }).toPass({ timeout: 15000 });

    // Press a NEWLINE first to put us on a fresh line.
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);

    // Mark current state so we can count occurrences strictly inside the
    // post-paste window.
    const PASTE_FIXTURE = `pasteCheck_${Math.random().toString(36).slice(2, 10)}`;
    const beforeText = await pane0.locator('.xterm').innerText();
    const beforeCount = countOccurrences(beforeText, PASTE_FIXTURE);
    expect(beforeCount).toBe(0);

    // Seed the clipboard, then make sure xterm's helper textarea is focused
    // (clicks elsewhere during typing may have stolen focus).
    await page.evaluate(async (val) => {
      await navigator.clipboard.writeText(val);
    }, PASTE_FIXTURE);
    await helperTextarea.focus();
    await page.waitForTimeout(200);

    // Dispatch a synthetic ClipboardEvent directly to the focused textarea —
    // this works regardless of headless clipboard quirks and faithfully
    // exercises the paste path xterm registers.
    await page.evaluate((val) => {
      const ta = document.activeElement;
      if (!ta) throw new Error('no active element to paste into');
      const dt = new DataTransfer();
      dt.setData('text/plain', val);
      const evt = new ClipboardEvent('paste', {
        clipboardData: dt,
        bubbles: true,
        cancelable: true,
      });
      ta.dispatchEvent(evt);
    }, PASTE_FIXTURE);

    // Assert paste landed.
    await expect(async () => {
      const t = await pane0.locator('.xterm').innerText();
      expect(t).toContain(PASTE_FIXTURE);
    }).toPass({ timeout: 5000 });

    // Allow a beat for any duplicate paste to surface, then count.
    await page.waitForTimeout(800);
    const afterText = await pane0.locator('.xterm').innerText();
    const afterCount = countOccurrences(afterText, PASTE_FIXTURE);

    // The fixture should appear in the DOM exactly once. The document-level
    // paste handler in Terminal.jsx filters out text payloads (it only
    // intercepts images), so xterm's native paste runs unopposed — no
    // duplication.
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
