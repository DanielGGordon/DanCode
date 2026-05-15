import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generate } from 'otplib';
import { io as ioClient } from 'socket.io-client';
import { createShellhost } from 'dancode-shellhost/src/server.js';
import { startServer, httpServer, terminalManager } from '../src/index.js';
import { clearSessions } from '../src/auth.js';

const TEST_PORT = 3097;
const TEST_USERNAME = 'shellhost-int-user';
const TEST_PASSWORD = 'testpassword123';

/**
 * End-to-end integration check on the server side:
 *   - Boot a real shellhost on a temp socket.
 *   - Boot the server pointing at that socket.
 *   - POST /api/terminals — server should call shellhost spawn.
 *   - Connect a WebSocket /terminal/:id — server should call shellhost attach
 *     and forward output bytes.
 *   - Write input — should reach the PTY.
 *   - DELETE /api/terminals/:id — server should call shellhost kill.
 */
describe('server <-> shellhost integration', () => {
  let host;
  let tempDir;
  let socketPath;
  let server;
  let storedToken;

  const authHeaders = () => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${storedToken}`,
  });

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'shellhost-server-int-'));
    socketPath = join(tempDir, 'shellhost.sock');
    host = createShellhost();
    await host.listen(socketPath);

    server = await startServer(TEST_PORT, {
      credentialsPath: join(tempDir, 'credentials.json'),
      projectsDir: join(tempDir, 'projects'),
      terminalsDir: join(tempDir, 'terminals'),
      shellhostSocket: socketPath,
      reconcileRetryDelay: 0,
    });

    // Set up auth
    const setupRes = await fetch(`http://localhost:${TEST_PORT}/api/auth/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: TEST_USERNAME, password: TEST_PASSWORD }),
    });
    const setupData = await setupRes.json();
    const totpSecret = setupData.totpSecret;
    const totpCode = await generate({ secret: totpSecret });
    const loginRes = await fetch(`http://localhost:${TEST_PORT}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: TEST_USERNAME, password: TEST_PASSWORD, totpCode }),
    });
    storedToken = (await loginRes.json()).token;
  }, 30000);

  afterAll(async () => {
    if (terminalManager) await terminalManager.destroyAll();
    if (terminalManager?.close) terminalManager.close();
    if (server) await new Promise((r) => server.close(r));
    if (host) await host.close();
    clearSessions();
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  }, 30000);

  it('routes POST /api/terminals through shellhost', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/api/terminals`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ projectSlug: 'int-proj', label: 'CLI' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toMatch(/^[a-f0-9-]{36}$/);
    expect(body.projectSlug).toBe('int-proj');

    // The terminal should also be present in shellhost's PTY manager.
    const live = host.manager.inspect(body.id);
    expect(live).not.toBeNull();
    expect(live.projectSlug).toBe('int-proj');

    // Cleanup
    await fetch(`http://localhost:${TEST_PORT}/api/terminals/${body.id}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    // Shellhost should now be unaware of it.
    expect(host.manager.inspect(body.id)).toBeNull();
  });

  it('proxies WebSocket input/output end-to-end through shellhost', async () => {
    const createRes = await fetch(`http://localhost:${TEST_PORT}/api/terminals`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ projectSlug: 'ws-proj', label: 'CLI' }),
    });
    const terminal = await createRes.json();

    const collected = [];
    const sock = ioClient(`http://localhost:${TEST_PORT}/terminal/${terminal.id}`, {
      auth: { token: storedToken },
      transports: ['websocket'],
      reconnection: false,
    });

    try {
      await new Promise((resolve, reject) => {
        sock.on('connect', resolve);
        sock.on('connect_error', reject);
        setTimeout(() => reject(new Error('socket connect timeout')), 5000);
      });

      const sawSentinel = new Promise((resolve) => {
        sock.on('output', (data) => {
          collected.push(data);
          if (collected.join('').includes('__WS_SENTINEL__')) resolve();
        });
      });

      sock.emit('input', "printf '__WS_SENTINEL__\\n'\n");

      await Promise.race([
        sawSentinel,
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 8000)),
      ]);

      expect(collected.join('')).toContain('__WS_SENTINEL__');
    } finally {
      sock.disconnect();
      await fetch(`http://localhost:${TEST_PORT}/api/terminals/${terminal.id}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
    }
  });

  it('DELETE /api/terminals/:id triggers shellhost kill', async () => {
    const createRes = await fetch(`http://localhost:${TEST_PORT}/api/terminals`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ projectSlug: 'kill-proj', label: 'CLI', command: 'sleep 30' }),
    });
    const terminal = await createRes.json();
    expect(host.manager.inspect(terminal.id)).not.toBeNull();

    const del = await fetch(`http://localhost:${TEST_PORT}/api/terminals/${terminal.id}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    expect(del.status).toBe(204);
    expect(host.manager.inspect(terminal.id)).toBeNull();
  });

  it('spawn uses TERM=xterm-256color via shellhost', async () => {
    // Attach to a live shell PTY and check $TERM. Listening before writing
    // to avoid races; using a distinctive sentinel so prompt noise doesn't
    // confuse the regex.
    const createRes = await fetch(`http://localhost:${TEST_PORT}/api/terminals`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ projectSlug: 'term-proj', label: 'CLI' }),
    });
    const terminal = await createRes.json();
    const sock = ioClient(`http://localhost:${TEST_PORT}/terminal/${terminal.id}`, {
      auth: { token: storedToken },
      transports: ['websocket'],
      reconnection: false,
    });
    try {
      await new Promise((r, j) => { sock.on('connect', r); sock.on('connect_error', j); });
      const seen = [];
      const got = new Promise((resolve) => {
        sock.on('output', (d) => {
          seen.push(d);
          if (/TERMVAL\[xterm-256color\]/.test(seen.join(''))) resolve();
        });
      });
      // Slight delay so the shell prompt is up before we write.
      await new Promise((r) => setTimeout(r, 250));
      sock.emit('input', 'printf "\\nTERMVAL[%s]\\n" "$TERM"\n');
      await Promise.race([
        got,
        new Promise((_, j) => setTimeout(() => j(new Error('timeout waiting for TERMVAL')), 10000)),
      ]);
      expect(seen.join('')).toMatch(/TERMVAL\[xterm-256color\]/);
    } finally {
      sock.disconnect();
      await fetch(`http://localhost:${TEST_PORT}/api/terminals/${terminal.id}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
    }
  }, 20000);
});
