import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { login, createProject, cleanupProject } from '../e2e/e2e-helpers.js';
import { createShellhostClient } from 'dancode-shellhost/src/client.js';

/**
 * Phase 3 acceptance E2E: surviving a forced server restart.
 *
 *  1. Open a project, focus a terminal pane.
 *  2. Type `echo __STEP1__` and wait for the output in the DOM.
 *  3. POST /api/test-only/kill-server — the supervising boot-stack respawns
 *     it. During the gap, a side-channel write through the shellhost UNIX
 *     socket injects `printf __GAP_<rand>__\n` into the SAME PTY.
 *  4. After the new server starts, the browser's Socket.IO reconnects and
 *     resumes the same terminal.
 *  5. Type `echo __STEP2__` via the still-open WebSocket.
 *  6. Assert: __STEP1__, __GAP_*__ (delivered via scrollback replay), and
 *     __STEP2__ all appear in the xterm buffer.
 */
const SHELLHOST_SOCKET = process.env.DANCODE_SHELLHOST_SOCKET
  || '/tmp/dancode-shellhost-e2e.sock';

test.describe('Server-restart survival', () => {
  let token;
  const created = [];

  test.afterEach(async ({ request }) => {
    for (const { slug, projectPath } of created) {
      await cleanupProject(request, slug, token, projectPath);
    }
    created.length = 0;
  });

  test('PTY survives kill-server; gap output replays; new input reaches the SAME PTY', async ({ page, request }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1280, height: 720 });
    token = await login(page);

    const proj = await createProject(page, `Restart ${Date.now()}`);
    created.push(proj);

    const pane0 = page.getByTestId('terminal-pane-0');
    await expect(pane0).toBeVisible({ timeout: 15000 });
    await expect(pane0.locator('.xterm')).toBeVisible({ timeout: 15000 });

    const terminalId = await pane0.locator('[data-testid="terminal"]').getAttribute('data-terminal-id');
    expect(terminalId).toMatch(/^[a-f0-9-]{36}$/);

    const helperTextarea = pane0.locator('textarea.xterm-helper-textarea');
    await helperTextarea.waitFor({ state: 'attached', timeout: 10000 });
    await helperTextarea.focus();
    await page.waitForTimeout(300);

    // STEP 1: type before the kill.
    await page.keyboard.type('printf __STEP1__$');
    await page.keyboard.press('Enter');
    await expect(async () => {
      const text = await readXtermBuffer(page, terminalId);
      // The shell prints `__STEP1__$` (no trailing newline from printf) and
      // then the prompt; assert the marker landed.
      expect(text).toContain('__STEP1__');
    }).toPass({ timeout: 20000 });

    // Capture the PID so we can verify the same OS process is still alive
    // after restart.
    const pidBeforeRes = await request.get(`/api/terminals/${terminalId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(pidBeforeRes.ok()).toBe(true);
    // The server's HTTP shape doesn't expose pid, so dig it out of shellhost
    // directly via a side-channel inspect.
    const sideClient = createShellhostClient({ socketPath: SHELLHOST_SOCKET });
    await sideClient.connect();
    const inspectBefore = await sideClient.inspect(terminalId);
    const pidBefore = inspectBefore.terminal.pid;
    expect(pidBefore).toBeGreaterThan(0);
    sideClient.close();

    // STEP 2: kill the server. The browser's Socket.IO will reconnect once
    // the supervisor respawns the server.
    const killRes = await request.post('/api/test-only/kill-server');
    expect(killRes.ok()).toBe(true);

    // Wait until the browser detects disconnect.
    const terminalNode = pane0.locator('[data-testid="terminal"]');
    await expect(async () => {
      const state = await terminalNode.getAttribute('data-connection-state');
      expect(state).not.toBe('connected');
    }).toPass({ timeout: 15000 });

    // Inject a marker into the SAME PTY via a side-channel UNIX-socket
    // connection while the server is down. This proves output produced
    // during the gap is captured to scrollback and replayed on reconnect.
    const GAP_MARKER = `__GAP_${Math.random().toString(36).slice(2, 10)}__`;
    const gapClient = createShellhostClient({ socketPath: SHELLHOST_SOCKET });
    await gapClient.connect();
    await gapClient.write(terminalId, `printf '${GAP_MARKER}\\n'\n`);
    // Give the PTY a beat to emit through scrollback.
    await page.waitForTimeout(300);
    gapClient.close();

    // Wait for the server to come back up and the WebSocket to reconnect.
    await expect(async () => {
      const state = await terminalNode.getAttribute('data-connection-state');
      expect(state).toBe('connected');
    }).toPass({ timeout: 60000 });

    // The replay must include the gap marker AND step1.
    await expect(async () => {
      const text = await readXtermBuffer(page, terminalId);
      expect(text).toContain('__STEP1__');
      expect(text).toContain(GAP_MARKER);
    }).toPass({ timeout: 20000 });

    // STEP 3: type into the SAME terminal after restart. New input must
    // reach the same PTY (which is still alive in shellhost).
    await helperTextarea.focus();
    await page.waitForTimeout(200);
    await page.keyboard.type('printf __STEP2__$');
    await page.keyboard.press('Enter');

    await expect(async () => {
      const text = await readXtermBuffer(page, terminalId);
      expect(text).toContain('__STEP2__');
    }).toPass({ timeout: 20000 });

    // PID must be unchanged — same child process across restart.
    const sideClient2 = createShellhostClient({ socketPath: SHELLHOST_SOCKET });
    await sideClient2.connect();
    const inspectAfter = await sideClient2.inspect(terminalId);
    expect(inspectAfter.terminal.pid).toBe(pidBefore);
    sideClient2.close();
  });
});

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
