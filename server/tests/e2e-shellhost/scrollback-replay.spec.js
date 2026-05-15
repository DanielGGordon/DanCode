import { test, expect } from '@playwright/test';
import { login, createProject, cleanupProject } from '../e2e/e2e-helpers.js';

/**
 * Phase 2 acceptance E2E: disk-persisted scrollback replay across browser
 * reloads.
 *
 * 1. Open a project, focus pane 0.
 * 2. Type a command that emits >100KB of output followed by a known sentinel.
 * 3. Wait until the sentinel appears in the live xterm buffer.
 * 4. Reload the page; assert the sentinel and last ~50KB of the output are
 *    present in the rebuilt xterm buffer (sourced from disk).
 * 5. Reload again; assert the sentinel appears exactly once (no duplicate
 *    replay on the second reconnect).
 */
test.describe('Disk-persisted scrollback replay', () => {
  let token;
  const created = [];

  test.afterEach(async ({ request }) => {
    for (const { slug, projectPath } of created) {
      await cleanupProject(request, slug, token, projectPath);
    }
    created.length = 0;
  });

  test('reload replays last ~50KB of disk scrollback; double reload does not duplicate', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    token = await login(page);

    const proj = await createProject(page, `Scrollback ${Date.now()}`);
    created.push(proj);

    const pane0 = page.getByTestId('terminal-pane-0');
    await expect(pane0).toBeVisible({ timeout: 15000 });
    await expect(pane0.locator('.xterm')).toBeVisible({ timeout: 15000 });

    // Read the terminal id off the pane wrapper.
    const terminalId = await pane0.locator('[data-testid="terminal"]').getAttribute('data-terminal-id');
    expect(terminalId).toMatch(/^[a-f0-9-]{36}$/);

    const helperTextarea = pane0.locator('textarea.xterm-helper-textarea');
    await helperTextarea.waitFor({ state: 'attached', timeout: 10000 });
    await helperTextarea.focus();
    await page.waitForTimeout(300);

    // Build the sentinel inside the shell so the input echo doesn't contain
    // the literal string. After bash runs, `__SCROLLBACK_END__` is printed.
    const SENTINEL = '__SCROLLBACK_END__';
    // 120,000 bytes of 'y' + newlines via `yes | head -c 120000`, then the
    // sentinel on its own line. The sentinel is built via string concat so
    // the literal substring never appears in the typed input itself.
    const command = `S=__SCROLLBACK; S="\${S}_END__"; yes | head -c 120000; printf '\\n%s\\n' "$S"`;
    await page.keyboard.type(command);
    await page.keyboard.press('Enter');

    // Wait for the sentinel to appear in the live xterm buffer.
    await expect(async () => {
      const text = await readXtermBuffer(page, terminalId);
      expect(text).toContain(SENTINEL);
    }).toPass({ timeout: 30000 });

    // --- First reload: scrollback must come from disk. ---
    await page.reload();
    await reopenProject(page, proj.slug);
    const paneAfterReload = page.getByTestId('terminal-pane-0');
    await expect(paneAfterReload).toBeVisible({ timeout: 15000 });
    await expect(paneAfterReload.locator('.xterm')).toBeVisible({ timeout: 15000 });
    const terminalAfterReload = paneAfterReload.locator('[data-testid="terminal"]');
    await expect(terminalAfterReload).toHaveAttribute('data-connection-state', 'connected', { timeout: 15000 });

    // The sentinel and a chunk of 'y' lines should be visible after replay.
    // The 50KB tail spans roughly 16-17K `y\r\n` triplets through a cooked
    // PTY, so we expect well over 10,000 'y' chars (and far more than xterm's
    // pre-bump 1000-line default scrollback could ever hold).
    await expect(async () => {
      const text = await readXtermBuffer(page, terminalId);
      expect(text).toContain(SENTINEL);
      const yCount = (text.match(/y/g) || []).length;
      expect(yCount).toBeGreaterThan(10_000);
    }).toPass({ timeout: 20000 });

    // --- Second reload: no duplicate sentinels. ---
    await page.reload();
    await reopenProject(page, proj.slug);
    const paneAfter2 = page.getByTestId('terminal-pane-0');
    await expect(paneAfter2).toBeVisible({ timeout: 15000 });
    await expect(paneAfter2.locator('.xterm')).toBeVisible({ timeout: 15000 });
    const terminalAfter2 = paneAfter2.locator('[data-testid="terminal"]');
    await expect(terminalAfter2).toHaveAttribute('data-connection-state', 'connected', { timeout: 15000 });

    // Allow replay to settle then count sentinel occurrences.
    await expect(async () => {
      const text = await readXtermBuffer(page, terminalId);
      expect(text).toContain(SENTINEL);
    }).toPass({ timeout: 20000 });
    // A short settle window for any out-of-order replay duplication to
    // surface in the DOM/buffer before we assert.
    await page.waitForTimeout(1500);
    const final = await readXtermBuffer(page, terminalId);
    const occurrences = countOccurrences(final, SENTINEL);
    expect(occurrences).toBe(1);
  });
});

async function reopenProject(page, slug) {
  // After a page reload the SPA returns to the project picker. Click the
  // sidebar entry for our project so the terminal layout mounts again.
  const sidebarEntry = page.getByTestId(`sidebar-project-${slug}`);
  await sidebarEntry.waitFor({ state: 'visible', timeout: 15000 });
  await sidebarEntry.click();
}

async function readXtermBuffer(page, terminalId) {
  return page.evaluate((tid) => {
    const map = window.__dancodeTerminals;
    const term = map && map.get(tid);
    if (!term) return '';
    const parts = [];
    const buf = term.buffer.active;
    for (let i = 0; i < buf.length; i++) {
      const line = buf.getLine(i);
      if (line) parts.push(line.translateToString(true));
    }
    return parts.join('\n');
  }, terminalId);
}

function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  let i = 0;
  let count = 0;
  while ((i = haystack.indexOf(needle, i)) !== -1) {
    count++;
    i += needle.length;
  }
  return count;
}
