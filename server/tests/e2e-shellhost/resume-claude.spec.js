import { test, expect } from '@playwright/test';
import { login, createProject, cleanupProject } from '../e2e/e2e-helpers.js';

/**
 * Phase 7 acceptance E2E: Resume Claude button.
 *
 *   1. Create a project (gets two default terminals; we use the CLI one).
 *   2. Use the wire op (via a small server route that already exists in
 *      this codebase: shellhost client.noteClaudeSession is reachable
 *      via /api/test-only/note-claude-session — added in Phase 7) to set
 *      a fake claudeSessionId on the terminal.
 *   3. Reload the page so the client's poll picks up the new value.
 *   4. Assert: [data-testid="resume-claude"] is visible on the CLI pane.
 *   5. Click it. Assert the corresponding `claude --resume <id>` text is
 *      sent to the terminal (the xterm DOM echoes shell input back when
 *      bash is the foreground process).
 */

test.describe('Phase 7: Resume Claude button', () => {
  let token;
  const created = [];

  test.afterEach(async ({ request }) => {
    for (const { slug, projectPath } of created) {
      await cleanupProject(request, slug, token, projectPath);
    }
    created.length = 0;
  });

  test('renders Resume Claude button, click sends `claude --resume <id>` to the terminal', async ({ page, request }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1280, height: 720 });
    token = await login(page);

    const proj = await createProject(page, `Phase7 ${Date.now()}`);
    created.push(proj);

    const pane0 = page.getByTestId('terminal-pane-0');
    await expect(pane0).toBeVisible({ timeout: 15000 });
    await expect(pane0.locator('.xterm')).toBeVisible({ timeout: 15000 });
    const term0Id = await pane0.locator('[data-testid="terminal"]').getAttribute('data-terminal-id');
    expect(term0Id).toMatch(/^[a-f0-9-]{36}$/);

    // Wait for pane0 socket to actually connect before we drive input.
    await expect(pane0.locator('[data-testid="terminal"]')).toHaveAttribute(
      'data-connection-state', 'connected', { timeout: 15_000 },
    );

    const FAKE_SESSION = `00000000-1111-2222-3333-${Date.now().toString().padStart(12, '0').slice(0, 12)}`;

    // Hit the test-only endpoint to set the session id on this terminal.
    const noteRes = await request.post('/api/test-only/note-claude-session', {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { terminalId: term0Id, sessionId: FAKE_SESSION },
    });
    if (!noteRes.ok()) {
      throw new Error(`note-claude-session returned ${noteRes.status()}: ${await noteRes.text()}`);
    }

    // The client polls /api/terminals?project=… every 7s. Wait for the
    // button to appear (poll is also seeded on focus).
    const resumeBtn = pane0.getByTestId('resume-claude');
    await expect(resumeBtn).toBeVisible({ timeout: 15_000 });
    await expect(resumeBtn).toContainText(/Resume Claude/i);
    const sidAttr = await resumeBtn.getAttribute('data-claude-session-id');
    expect(sidAttr).toBe(FAKE_SESSION);

    // Click it: should send `claude --resume <id>\r` to the terminal.
    await resumeBtn.click();

    // Bash echoes typed input back; assert the xterm buffer (via the live
    // window-exposed Map) contains the resume command + the session id.
    // The terminal column width may wrap long lines; we normalise to one
    // contiguous string before matching.
    await expect(async () => {
      const text = await page.evaluate((tid) => {
        const map = window.__dancodeTerminals;
        const term = map && map.get(tid);
        if (!term) return '';
        const parts = [];
        const buf = term.buffer.active;
        for (let i = 0; i < buf.length; i++) {
          const line = buf.getLine(i);
          if (line) parts.push(line.translateToString(true));
        }
        return parts.join('');
      }, term0Id);
      // Strip all whitespace before substring-matching so wrapped output
      // doesn't introduce gaps inside our session id.
      const normalised = text.replace(/\s+/g, '');
      expect(normalised).toContain('claude--resume');
      expect(normalised).toContain(FAKE_SESSION);
    }).toPass({ timeout: 10_000 });
  });

  test('dismiss button hides Resume Claude until next page load', async ({ page, request }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 1280, height: 720 });
    token = await login(page);

    const proj = await createProject(page, `Phase7-dismiss ${Date.now()}`);
    created.push(proj);

    const pane0 = page.getByTestId('terminal-pane-0');
    await expect(pane0).toBeVisible({ timeout: 15000 });
    const term0Id = await pane0.locator('[data-testid="terminal"]').getAttribute('data-terminal-id');

    const FAKE_SESSION = `aaaaaaaa-bbbb-cccc-dddd-${Date.now().toString().slice(0, 12).padStart(12, '0')}`;
    const noteRes = await request.post('/api/test-only/note-claude-session', {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { terminalId: term0Id, sessionId: FAKE_SESSION },
    });
    if (!noteRes.ok()) {
      throw new Error(`note-claude-session returned ${noteRes.status()}: ${await noteRes.text()}`);
    }

    const resumeBtn = pane0.getByTestId('resume-claude');
    await expect(resumeBtn).toBeVisible({ timeout: 15_000 });
    await pane0.getByTestId('resume-claude-dismiss').click();
    await expect(pane0.getByTestId('resume-claude')).toHaveCount(0);
  });
});
