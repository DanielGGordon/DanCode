import { test, expect } from '@playwright/test';
import { login, createProject, cleanupProject } from './e2e-helpers.js';

const PROJECT_NAME = `Reconnect ${Date.now()}`;

/**
 * Reconnection UX E2E test:
 *   1. Create project, connect to terminal
 *   2. Verify connection state indicator (green dot)
 *   3. Simulate network drop (disconnect socket via page.evaluate)
 *   4. Verify "Reconnecting..." overlay appears
 *   5. Reconnect socket
 *   6. Verify overlay disappears and terminal is interactive
 */
test.describe('Reconnection UX', () => {
  let token;
  const created = [];

  test.afterEach(async ({ request }) => {
    for (const { slug, projectPath } of created) {
      await cleanupProject(request, slug, token, projectPath);
    }
  });

  test('shows reconnecting overlay on disconnect, recovers on reconnect', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    token = await login(page);

    // 1. Create project — auto-creates 2 terminals (CLI + Claude)
    const proj = await createProject(page, PROJECT_NAME);
    created.push(proj);

    // Wait for terminal panes to be visible
    const pane0 = page.getByTestId('terminal-pane-0');
    await expect(pane0).toBeVisible({ timeout: 10000 });
    await expect(pane0.locator('.xterm')).toBeVisible({ timeout: 10000 });

    // 2. Wait for connected state (green dot)
    const dot0 = page.getByTestId('connection-dot-0');
    await expect(dot0).toBeVisible();
    // Wait for the terminal to connect — dot should have bg-green class
    await expect(dot0).toHaveClass(/bg-green/, { timeout: 10000 });

    // Verify terminal is connected (data attribute on terminal element)
    const terminal0 = pane0.locator('[data-testid="terminal"]');
    await expect(terminal0).toHaveAttribute('data-connection-state', 'connected', { timeout: 10000 });

    // 3. Type something before disconnect to verify output is present
    await pane0.click();
    await page.keyboard.type('echo BEFORE_DISCONNECT\n', { delay: 30 });
    // Give the command time to execute
    await page.waitForTimeout(1000);

    // 4. Simulate network drop by disconnecting all Socket.io sockets
    await page.evaluate(() => {
      // Access Socket.io manager instances and force disconnect
      const ioModule = window.__socketio_sockets;
      if (ioModule) {
        for (const s of ioModule) {
          s.io.engine.close();
        }
      }
    });

    // The above approach may not work if sockets aren't exposed. Use a more
    // reliable approach: disconnect via the socket.io transport layer
    // by intercepting and breaking the WebSocket connection.
    await page.evaluate(() => {
      // Force-close all WebSocket connections to simulate network drop
      const originalWS = window.WebSocket;
      const sockets = [];

      // Close existing WebSocket connections
      // We need to find the existing connections - patch prototype to track
      // Actually, let's use a different approach: override WebSocket.prototype.send
      // to throw, which will cause socket.io to disconnect

      // Find socket.io manager objects in the page
      // Socket.io stores the manager on the socket instance
      // We can access it through the React component tree or window objects
    });

    // More reliable: use Chrome DevTools Protocol to emulate network offline
    const cdpSession = await page.context().newCDPSession(page);
    await cdpSession.send('Network.emulateNetworkConditions', {
      offline: true,
      latency: 0,
      downloadThroughput: 0,
      uploadThroughput: 0,
    });

    // 5. Verify "Reconnecting..." overlay appears
    const overlay = pane0.locator('[data-testid="terminal-overlay"]');
    await expect(overlay).toBeVisible({ timeout: 10000 });
    await expect(overlay).toContainText('Reconnecting');

    // Verify the connection dot changes to yellow (reconnecting)
    await expect(dot0).toHaveClass(/bg-yellow/, { timeout: 5000 });

    // 6. Restore network connection
    await cdpSession.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });

    // 7. Verify overlay disappears and terminal reconnects
    await expect(overlay).not.toBeVisible({ timeout: 15000 });

    // Verify green dot is back
    await expect(dot0).toHaveClass(/bg-green/, { timeout: 10000 });

    // Verify terminal is interactive after reconnect
    await expect(terminal0).toHaveAttribute('data-connection-state', 'connected', { timeout: 10000 });

    // 8. Type a command to verify terminal is interactive after reconnect
    await pane0.click();
    await page.keyboard.type('echo AFTER_RECONNECT\n', { delay: 30 });
    await page.waitForTimeout(1000);

    // The terminal should show the output (ring buffer replayed + new output)
    // We can verify by checking the xterm content
    const terminalText = await terminal0.evaluate((el) => {
      const rows = el.querySelectorAll('.xterm-rows > div');
      return Array.from(rows).map((r) => r.textContent).join('\n');
    });
    expect(terminalText).toContain('AFTER_RECONNECT');

    await cdpSession.detach();
  });

  test('shows session-ended overlay when terminal process exits', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    token = await login(page);

    const proj = await createProject(page, `Exit ${Date.now()}`);
    created.push(proj);

    const pane0 = page.getByTestId('terminal-pane-0');
    await expect(pane0).toBeVisible({ timeout: 10000 });
    await expect(pane0.locator('.xterm')).toBeVisible({ timeout: 10000 });

    // Wait for terminal to connect
    const terminal0 = pane0.locator('[data-testid="terminal"]');
    await expect(terminal0).toHaveAttribute('data-connection-state', 'connected', { timeout: 10000 });

    // Type 'exit' to end the shell session
    await pane0.click();
    await page.keyboard.type('exit\n', { delay: 30 });

    // Verify "Session Ended" overlay appears
    const overlay = pane0.locator('[data-testid="terminal-overlay"]');
    await expect(overlay).toBeVisible({ timeout: 10000 });
    await expect(overlay).toContainText('Session Ended');

    // Verify connection dot is red
    const dot0 = page.getByTestId('connection-dot-0');
    await expect(dot0).toHaveClass(/bg-red/, { timeout: 5000 });
  });

  test('shows connection state indicators per terminal', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    token = await login(page);

    const proj = await createProject(page, `Dots ${Date.now()}`);
    created.push(proj);

    // Both terminals should show green dots when connected
    const dot0 = page.getByTestId('connection-dot-0');
    const dot1 = page.getByTestId('connection-dot-1');
    await expect(dot0).toBeVisible({ timeout: 10000 });
    await expect(dot1).toBeVisible({ timeout: 10000 });
    await expect(dot0).toHaveClass(/bg-green/, { timeout: 10000 });
    await expect(dot1).toHaveClass(/bg-green/, { timeout: 10000 });
  });
});
