import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createShellhost } from 'dancode-shellhost/src/server.js';
import { PTYManager } from 'dancode-shellhost/src/pty-manager.js';
import { ScrollbackStore } from 'dancode-shellhost/src/scrollback.js';
import { MetaStore } from 'dancode-shellhost/src/meta-store.js';
import { startServer, httpServer, terminalManager } from '../src/index.js';
import { clearSessions, createSession } from '../src/auth.js';

/**
 * Phase 8: Background-mode terminal API.
 *
 * The server-side surface adds:
 *   - `background: true` to POST /api/terminals
 *   - POST /api/terminals/:id/background  -> { background: bool }
 *
 * Both reach shellhost via the existing shellhost client. We use a fake
 * `runSystemctl` injected into PTYManager so background-mode tests don't
 * require a real systemd user session.
 */
const TEST_PORT = 3196;
const TEST_USERNAME = 'bg-user';

describe('background-mode HTTP API', () => {
  let host;
  let tempDir;
  let socketPath;
  let server;
  let token;
  let systemctlCalls;

  const authHeaders = () => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  });

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'bg-api-'));
    socketPath = join(tempDir, 'shellhost.sock');
    systemctlCalls = [];
    const scrollback = new ScrollbackStore({ baseDir: join(tempDir, 'sb') });
    const metaStore = new MetaStore({ baseDir: join(tempDir, 'sb') });
    const manager = new PTYManager({
      scrollback,
      metaStore,
      runSystemctl: (args) => { systemctlCalls.push(args); return { ok: true }; },
    });
    host = createShellhost({ manager });
    await host.listen(socketPath);

    server = await startServer(TEST_PORT, {
      credentialsPath: join(tempDir, 'credentials.json'),
      projectsDir: join(tempDir, 'projects'),
      terminalsDir: join(tempDir, 'terminals'),
      shellhostSocket: socketPath,
      reconcileRetryDelay: 0,
    });

    token = createSession(TEST_USERNAME);
  }, 30000);

  afterAll(async () => {
    if (terminalManager) await terminalManager.destroyAll();
    if (terminalManager?.close) terminalManager.close();
    if (server) await new Promise((r) => server.close(r));
    if (host) await host.close();
    clearSessions();
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  }, 30000);

  it('POST /api/terminals accepts background:true and propagates to shellhost', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/api/terminals`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        projectSlug: 'bg-proj',
        label: 'Build',
        command: 'sleep 30',
        background: true,
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.background).toBe(true);

    // Shellhost-side inspect must confirm the flag.
    const inspect = host.manager.inspect(body.id);
    expect(inspect.background).toBe(true);

    // Cleanup
    await fetch(`http://localhost:${TEST_PORT}/api/terminals/${body.id}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
  });

  it('POST /api/terminals without background defaults to background:false', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/api/terminals`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ projectSlug: 'fg-proj', label: 'CLI' }),
    });
    const body = await res.json();
    expect(body.background).toBe(false);
    await fetch(`http://localhost:${TEST_PORT}/api/terminals/${body.id}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
  });

  it('POST /api/terminals/:id/background toggles the flag on shellhost', async () => {
    const createRes = await fetch(`http://localhost:${TEST_PORT}/api/terminals`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ projectSlug: 'toggle-proj', label: 'CLI', command: 'sleep 30' }),
    });
    const t = await createRes.json();
    expect(t.background).toBe(false);

    const toggle = await fetch(
      `http://localhost:${TEST_PORT}/api/terminals/${t.id}/background`,
      {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ background: true }),
      }
    );
    expect(toggle.status).toBe(200);
    const updated = await toggle.json();
    expect(updated.background).toBe(true);

    // Shellhost-side inspect confirms.
    const inspect = host.manager.inspect(t.id);
    expect(inspect.background).toBe(true);

    // GET /api/terminals/:id also reports the new flag.
    const getRes = await fetch(`http://localhost:${TEST_PORT}/api/terminals/${t.id}`, {
      headers: authHeaders(),
    });
    expect((await getRes.json()).background).toBe(true);

    await fetch(`http://localhost:${TEST_PORT}/api/terminals/${t.id}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
  });

  it('POST /api/terminals/:id/background accepts background:false', async () => {
    const createRes = await fetch(`http://localhost:${TEST_PORT}/api/terminals`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        projectSlug: 'untoggle-proj',
        label: 'CLI',
        command: 'sleep 30',
        background: true,
      }),
    });
    const t = await createRes.json();
    expect(t.background).toBe(true);

    const toggle = await fetch(
      `http://localhost:${TEST_PORT}/api/terminals/${t.id}/background`,
      {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ background: false }),
      }
    );
    const updated = await toggle.json();
    expect(updated.background).toBe(false);

    await fetch(`http://localhost:${TEST_PORT}/api/terminals/${t.id}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
  });

  it('POST /api/terminals/:id/background 404s for unknown terminal', async () => {
    const res = await fetch(
      `http://localhost:${TEST_PORT}/api/terminals/does-not-exist/background`,
      {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ background: true }),
      }
    );
    expect(res.status).toBe(404);
  });

  it('POST /api/terminals/:id/background 400s when background is not a boolean', async () => {
    const createRes = await fetch(`http://localhost:${TEST_PORT}/api/terminals`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ projectSlug: 'bad-proj', label: 'CLI', command: 'sleep 30' }),
    });
    const t = await createRes.json();
    const res = await fetch(
      `http://localhost:${TEST_PORT}/api/terminals/${t.id}/background`,
      {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ background: 'sometimes' }),
      }
    );
    expect(res.status).toBe(400);
    await fetch(`http://localhost:${TEST_PORT}/api/terminals/${t.id}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
  });

  it('DELETE /api/terminals/:id on background terminal invokes systemctl stop', async () => {
    systemctlCalls.length = 0;
    const createRes = await fetch(`http://localhost:${TEST_PORT}/api/terminals`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        projectSlug: 'del-bg',
        label: 'Build',
        command: 'sleep 30',
        background: true,
      }),
    });
    const t = await createRes.json();
    expect(t.background).toBe(true);

    const del = await fetch(`http://localhost:${TEST_PORT}/api/terminals/${t.id}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    expect(del.status).toBe(204);
    // The systemctl runner was invoked for this terminal's scope.
    expect(systemctlCalls).toContainEqual(['--user', 'stop', `dancode-bg-${t.id}.scope`]);
  });
});
