import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generate } from 'otplib';
import { createShellhost } from 'dancode-shellhost/src/server.js';
import { PTYManager } from 'dancode-shellhost/src/pty-manager.js';
import { ScrollbackStore } from 'dancode-shellhost/src/scrollback.js';
import { MetaStore } from 'dancode-shellhost/src/meta-store.js';
import { startServer, terminalManager } from '../src/index.js';
import { clearSessions } from '../src/auth.js';

const TEST_PORT = 3098;
const TEST_USERNAME = 'claude-session-user';
const TEST_PASSWORD = 'testpassword123';

describe('server exposes claudeSessionId on terminal meta', () => {
  let host;
  let tempDir;
  let socketPath;
  let server;
  let storedToken;
  let manager;

  const authHeaders = () => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${storedToken}`,
  });

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'claude-session-meta-'));
    socketPath = join(tempDir, 'shellhost.sock');
    const baseDir = join(tempDir, 'sb-terminals');
    const scrollback = new ScrollbackStore({ baseDir });
    const metaStore = new MetaStore({ baseDir });
    manager = new PTYManager({ scrollback, metaStore });
    host = createShellhost({ manager });
    await host.listen(socketPath);

    server = await startServer(TEST_PORT, {
      credentialsPath: join(tempDir, 'credentials.json'),
      projectsDir: join(tempDir, 'projects'),
      terminalsDir: join(tempDir, 'terminals'),
      shellhostSocket: socketPath,
      reconcileRetryDelay: 0,
    });

    const setupRes = await fetch(`http://localhost:${TEST_PORT}/api/auth/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: TEST_USERNAME, password: TEST_PASSWORD }),
    });
    const setupData = await setupRes.json();
    const totpCode = await generate({ secret: setupData.totpSecret });
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

  it('GET /api/terminals?project=… returns claudeSessionId in each entry (defaulting to null)', async () => {
    const r = await fetch(`http://localhost:${TEST_PORT}/api/terminals`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ projectSlug: 'claude-meta', label: 'CLI' }),
    });
    expect(r.status).toBe(201);
    const created = await r.json();
    expect(created).toHaveProperty('claudeSessionId');
    expect(created.claudeSessionId).toBeNull();

    const listRes = await fetch(`http://localhost:${TEST_PORT}/api/terminals?project=claude-meta`, {
      headers: authHeaders(),
    });
    const list = await listRes.json();
    const entry = list.find((t) => t.id === created.id);
    expect(entry).toHaveProperty('claudeSessionId');
    expect(entry.claudeSessionId).toBeNull();

    await fetch(`http://localhost:${TEST_PORT}/api/terminals/${created.id}`, {
      method: 'DELETE', headers: authHeaders(),
    });
  });

  it('after shellhost noteClaudeSession, the server-side list/get reflects the session id', async () => {
    const r = await fetch(`http://localhost:${TEST_PORT}/api/terminals`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ projectSlug: 'claude-live', label: 'CLI' }),
    });
    const created = await r.json();

    // Drive the wire op directly via the in-process manager so we don't need
    // the periodic detector to fire in this test.
    manager.setClaudeSessionId(created.id, 'sid-from-test');

    // The server's manager refreshes from shellhost on each `get`/`list`?
    // Phase 7 requirement: the server exposes the session id. We assert via
    // GET /api/terminals/:id which should pull from the server's cache OR
    // refresh from shellhost.
    const single = await fetch(`http://localhost:${TEST_PORT}/api/terminals/${created.id}`, {
      headers: authHeaders(),
    });
    expect(single.status).toBe(200);
    const body = await single.json();
    expect(body.claudeSessionId).toBe('sid-from-test');

    await fetch(`http://localhost:${TEST_PORT}/api/terminals/${created.id}`, {
      method: 'DELETE', headers: authHeaders(),
    });
  });
});
