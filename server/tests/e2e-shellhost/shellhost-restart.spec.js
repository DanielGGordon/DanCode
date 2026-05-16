import { test, expect } from '@playwright/test';
import { login, createProject, cleanupProject } from '../e2e/e2e-helpers.js';

/**
 * Phase 5 acceptance E2E: full Pi-reboot simulation.
 *
 *  1. Create a project (server auto-creates 2 default terminals: CLI + Claude).
 *  2. Write a distinct sentinel into each terminal.
 *  3. Hit /api/test-only/restart-shellhost — boot-stack SIGKILLs shellhost,
 *     respawns it; the server reconnects and recovers the orphan list.
 *  4. Reload the project page. The layout-GET triggers respawn for each
 *     terminal. The Socket.IO terminal namespace also auto-respawns as a
 *     safety net.
 *  5. Assert: both terminals appear, each banner ('--- prior session ended at')
 *     is visible in its DOM, the prior sentinel output is in each terminal's
 *     scrollback DOM.
 */

test.describe('Pi-reboot recovery (Phase 5)', () => {
  let token;
  const created = [];

  test.afterEach(async ({ request }) => {
    for (const { slug, projectPath } of created) {
      await cleanupProject(request, slug, token, projectPath);
    }
    created.length = 0;
  });

  test('two terminals survive shellhost SIGKILL+restart with banner + scrollback in DOM', async ({ page, request }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1280, height: 720 });
    token = await login(page);

    const proj = await createProject(page, `Phase5 ${Date.now()}`);
    created.push(proj);

    // Wait for the two default terminal panes.
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

    const SENTINEL_A = `__PHASE5_AAA_${Math.random().toString(36).slice(2, 8)}__`;
    const SENTINEL_B = `__PHASE5_BBB_${Math.random().toString(36).slice(2, 8)}__`;

    // Pane 1 (the Claude terminal) is running `claude` which won't echo a
    // shell sentinel cleanly. Replace its terminal with a fresh bash terminal
    // so both panes give us clean shell echo. We do this by killing termB
    // and replacing it via the API.
    // (The default Claude terminal command may not have `claude` installed
    // in CI; rely on the project's REST API to make a clean test setup.)

    // Send the sentinel into both terminals (printf to a real shell — replace
    // termB to use a plain shell rather than the default `claude` invocation).
    // Replace the second default terminal with a plain shell:
    await request.delete(`/api/terminals/${term1Id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const newTerm = await (await request.post('/api/terminals', {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { projectSlug: proj.slug, label: 'Plain', cwd: proj.projectPath },
    })).json();

    // Update the project's terminal ordering so reloads keep both visible.
    await request.patch(`/api/projects/${proj.slug}`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { terminals: [term0Id, newTerm.id] },
    });
    // Persist a layout that references both terminals (so the layout-GET
    // triggers respawn-per-terminal-in-layout on reload).
    await request.put(`/api/projects/${proj.slug}/layout`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: {
        terminals: [
          { id: term0Id, cwd: proj.projectPath, command: null, claudeSessionId: null, background: false, label: 'CLI' },
          { id: newTerm.id, cwd: proj.projectPath, command: null, claudeSessionId: null, background: false, label: 'Plain' },
        ],
        openFiles: [],
        splits: null,
        focusedPane: term0Id,
      },
    });

    await page.reload();

    // Reopen the project (sidebar) and wait for the freshly-listed terminals.
    await page.getByTestId(`sidebar-project-${proj.slug}`).click();
    await expect(page.getByTestId('terminal-pane-0')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('terminal-pane-1')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('terminal-pane-0').locator('.xterm')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('terminal-pane-1').locator('.xterm')).toBeVisible({ timeout: 15000 });

    // Type distinct sentinels into each pane.
    await typeIntoPane(page, 0, `printf '\\n%s\\n' '${SENTINEL_A}'`);
    await typeIntoPane(page, 1, `printf '\\n%s\\n' '${SENTINEL_B}'`);

    // Wait for sentinels to appear in their respective terminal DOMs.
    await expect(async () => {
      const t0 = await readXtermBuffer(page, term0Id);
      const t1 = await readXtermBuffer(page, newTerm.id);
      expect(t0).toContain(SENTINEL_A);
      expect(t1).toContain(SENTINEL_B);
    }).toPass({ timeout: 20_000 });

    // ── Trigger shellhost restart ──
    const restartRes = await request.post('/api/test-only/restart-shellhost', {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 60_000,
    });
    if (!restartRes.ok()) {
      const body = await restartRes.text().catch(() => '<unreadable>');
      throw new Error(`restart-shellhost returned ${restartRes.status()}: ${body}`);
    }

    // ── Reload the project page ──
    await page.reload();
    await page.getByTestId(`sidebar-project-${proj.slug}`).click();
    await expect(page.getByTestId('terminal-pane-0')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('terminal-pane-1')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('terminal-pane-0').locator('.xterm')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('terminal-pane-1').locator('.xterm')).toBeVisible({ timeout: 30_000 });

    // The xterm DOM should now show, for each terminal, the prior sentinel
    // AND the banner that respawn injected.
    await expect(async () => {
      const t0 = await readXtermBuffer(page, term0Id);
      const t1 = await readXtermBuffer(page, newTerm.id);
      expect(t0).toContain('--- prior session ended at');
      expect(t1).toContain('--- prior session ended at');
      expect(t0).toContain(SENTINEL_A);
      expect(t1).toContain(SENTINEL_B);
    }).toPass({ timeout: 30_000 });
  });
});

async function typeIntoPane(page, paneIndex, text) {
  const pane = page.getByTestId(`terminal-pane-${paneIndex}`);
  await pane.click();
  const helper = pane.locator('textarea.xterm-helper-textarea');
  await helper.waitFor({ state: 'attached', timeout: 10_000 });
  await helper.focus();
  await page.waitForTimeout(150);
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
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
