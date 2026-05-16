import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createShellhost } from 'dancode-shellhost/src/server.js';
import { PTYManager } from 'dancode-shellhost/src/pty-manager.js';
import { ScrollbackStore } from 'dancode-shellhost/src/scrollback.js';
import { ShellhostTerminalManager } from '../src/shellhost-terminal-manager.js';
import { startServer, httpServer, terminalManager as exportedTM } from '../src/index.js';
import { clearSessions, createSession } from '../src/auth.js';

/**
 * Phase 3: server-restart survival.
 *
 * The server doesn't own PTYs — shellhost does. After a server restart, the
 * server must rebuild its in-memory terminal map from shellhost's `list` op
 * without disturbing the running PTYs.
 */
describe('ShellhostTerminalManager.recover()', () => {
  let tempDir;
  let socketPath;
  let host;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'srv-recover-'));
    socketPath = join(tempDir, 'shellhost.sock');
    const scrollback = new ScrollbackStore({ baseDir: join(tempDir, 'sb') });
    const manager = new PTYManager({ scrollback });
    host = createShellhost({ manager });
    await host.listen(socketPath);
  });

  afterEach(async () => {
    if (host) await host.close();
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  });

  it('rebuilds the in-memory terminal map from shellhost list', async () => {
    // Phase A: server #1 creates two terminals, then "dies" (we close the manager).
    const mgr1 = new ShellhostTerminalManager({ socketPath });
    await mgr1.client.connect();
    const t1 = await mgr1.create({ projectSlug: 'p', label: 'CLI', command: 'sleep 30' });
    const t2 = await mgr1.create({ projectSlug: 'p', label: 'Claude', command: 'sleep 30' });
    mgr1.close();

    // Phase B: server #2 starts and reconciles via list.
    const mgr2 = new ShellhostTerminalManager({ socketPath });
    await mgr2.client.connect();
    const recovered = await mgr2.recover();
    expect(recovered).toBeGreaterThanOrEqual(2);

    const list = mgr2.list();
    const ids = list.map((t) => t.id).sort();
    expect(ids).toContain(t1.id);
    expect(ids).toContain(t2.id);

    // Recovered entries preserve identity (projectSlug at minimum).
    const got1 = mgr2.get(t1.id);
    expect(got1).not.toBeNull();
    expect(got1.projectSlug).toBe('p');

    // Cleanup
    await mgr2.destroy(t1.id);
    await mgr2.destroy(t2.id);
    mgr2.close();
  });

  it('the PTY child PID survives a manager close + recover (no process churn)', async () => {
    const mgr1 = new ShellhostTerminalManager({ socketPath });
    await mgr1.client.connect();
    const t = await mgr1.create({ projectSlug: 'pid-keep', label: 'CLI', command: 'sleep 30' });
    const before = await mgr1.client.inspect(t.id);
    const pidBefore = before.terminal.pid;
    expect(pidBefore).toBeGreaterThan(0);
    // Process must actually be alive.
    expect(() => process.kill(pidBefore, 0)).not.toThrow();
    mgr1.close();

    // Pretend the server died and a new one started.
    const mgr2 = new ShellhostTerminalManager({ socketPath });
    await mgr2.client.connect();
    await mgr2.recover();

    const after = await mgr2.client.inspect(t.id);
    expect(after.terminal.pid).toBe(pidBefore);
    // And the OS-level process must still be running.
    expect(() => process.kill(pidBefore, 0)).not.toThrow();

    await mgr2.destroy(t.id);
    mgr2.close();
  });

  it('recovered terminal forwards live output to a newly attached socket', async () => {
    const mgr1 = new ShellhostTerminalManager({ socketPath });
    await mgr1.client.connect();
    const t = await mgr1.create({ projectSlug: 'live-out', label: 'CLI' });
    mgr1.close();

    const mgr2 = new ShellhostTerminalManager({ socketPath });
    await mgr2.client.connect();
    await mgr2.recover();

    // Fake a Socket.IO client: collect emitted output frames.
    const received = [];
    const fakeSocket = {
      emit: (event, data) => {
        if (event === 'output') received.push(String(data));
      },
      disconnect() { /* noop */ },
    };
    mgr2.attach(t.id, fakeSocket);

    // Drive the recovered terminal: it MUST emit live output through mgr2.
    const sawSentinel = new Promise((resolve, reject) => {
      const start = Date.now();
      const tick = setInterval(() => {
        if (received.join('').includes('__RESTART_LIVE__')) {
          clearInterval(tick);
          resolve();
        } else if (Date.now() - start > 8000) {
          clearInterval(tick);
          reject(new Error(`timeout: saw ${JSON.stringify(received.join(''))}`));
        }
      }, 50);
    });
    await mgr2.write(t.id, "printf '__RESTART_LIVE__\\n'\n");
    await sawSentinel;

    await mgr2.destroy(t.id);
    mgr2.close();
  }, 15000);
});

/**
 * The full path: boot dancode-server, create a terminal, kill the server,
 * boot a second server pointing at the same shellhost — assert that listing
 * via the second server's HTTP API includes the original terminal and its
 * shellhost-side PID is unchanged.
 */
describe('startServer() recovers terminals from shellhost on restart', () => {
  const TEST_USERNAME = 'restart-user';
  const TEST_PASSWORD = 'restart-pw-123';
  const TEST_PORT = 3199;

  let host;
  let tempDir;
  let socketPath;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'srv-restart-int-'));
    socketPath = join(tempDir, 'shellhost.sock');
    const scrollback = new ScrollbackStore({ baseDir: join(tempDir, 'sb') });
    const manager = new PTYManager({ scrollback });
    host = createShellhost({ manager });
    await host.listen(socketPath);
  });

  afterEach(async () => {
    try { await new Promise((r) => httpServer.close(r)); } catch { /* may be open */ }
    if (exportedTM?.close) {
      try { exportedTM.close(); } catch { /* ignore */ }
    }
    clearSessions();
    if (host) await host.close();
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  });

  async function bootServer() {
    return startServer(TEST_PORT, {
      credentialsPath: join(tempDir, 'credentials.json'),
      projectsDir: join(tempDir, 'projects'),
      terminalsDir: join(tempDir, 'tm-legacy'),
      shellhostSocket: socketPath,
      reconcileRetryDelay: 0,
    });
  }

  function authenticate() {
    // Bypass the TOTP flow: directly mint a session token via the in-process
    // auth module. Using HTTP login would tie the test to the 30-second
    // TOTP window which can flake under slow CI / Pi runs.
    return createSession(TEST_USERNAME);
  }

  async function stopServer() {
    if (exportedTM?.close) {
      try { exportedTM.close(); } catch { /* ignore */ }
    }
    await new Promise((r) => httpServer.close(r));
  }

  it('GET /api/terminals on the restarted server lists the original terminal', async () => {
    await bootServer();
    const token1 = authenticate();

    // Create a terminal that won't exit on its own.
    const createRes = await fetch(`http://localhost:${TEST_PORT}/api/terminals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token1}` },
      body: JSON.stringify({ projectSlug: 'restart-proj', label: 'CLI', command: 'sleep 30' }),
    });
    expect(createRes.status).toBe(201);
    const created = await createRes.json();

    // Record PID via shellhost direct.
    const beforeInspect = host.manager.inspect(created.id);
    const pidBefore = beforeInspect?.pid;
    expect(pidBefore).toBeGreaterThan(0);

    // Kill server (graceful close + clearSessions to simulate a fresh process).
    await stopServer();
    clearSessions();

    // Process is still alive at OS level.
    expect(() => process.kill(pidBefore, 0)).not.toThrow();

    // Boot a NEW server pointing at the same shellhost; it must recover.
    await bootServer();
    const token2 = authenticate();

    const listRes = await fetch(`http://localhost:${TEST_PORT}/api/terminals?project=restart-proj`, {
      headers: { Authorization: `Bearer ${token2}` },
    });
    expect(listRes.status).toBe(200);
    const list = await listRes.json();
    const ids = list.map((t) => t.id);
    expect(ids).toContain(created.id);

    // PID unchanged on shellhost side.
    const afterInspect = host.manager.inspect(created.id);
    expect(afterInspect.pid).toBe(pidBefore);
    expect(() => process.kill(pidBefore, 0)).not.toThrow();

    // Cleanup terminal.
    await fetch(`http://localhost:${TEST_PORT}/api/terminals/${created.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token2}` },
    });
  }, 30000);

  it('output produced while the server is down is persisted to scrollback.log', async () => {
    await bootServer();
    const token1 = authenticate();

    // Spawn a long-running terminal we control via writes.
    const createRes = await fetch(`http://localhost:${TEST_PORT}/api/terminals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token1}` },
      body: JSON.stringify({ projectSlug: 'gap-proj', label: 'CLI' }),
    });
    const created = await createRes.json();

    // Kill the server.
    await stopServer();
    clearSessions();

    // While the server is down, drive a side-channel write directly through
    // shellhost. This simulates "server is down but the PTY is still
    // producing output" — e.g. a background `find` job or another tab.
    const { createShellhostClient } = await import('dancode-shellhost/src/client.js');
    const sideClient = createShellhostClient({ socketPath });
    await sideClient.connect();

    const MARKER = `__GAP_${Math.random().toString(36).slice(2, 10)}__`;
    await sideClient.write(created.id, `printf '${MARKER}\\n'\n`);

    // Give the PTY a moment to emit the bytes through shellhost's
    // scrollback writer.
    await new Promise((r) => setTimeout(r, 500));
    sideClient.close();

    // Read disk scrollback DIRECTLY (no replay round-trip) to assert the
    // marker bytes hit disk while no server was attached.
    const { readFile } = await import('node:fs/promises');
    const logPath = join(tempDir, 'sb', created.id, 'scrollback.log');
    const log = await readFile(logPath, 'utf8');
    expect(log).toContain(MARKER);

    // Boot a NEW server; recovery must pick the terminal up.
    await bootServer();
    const token2 = authenticate();
    const list = await (await fetch(`http://localhost:${TEST_PORT}/api/terminals?project=gap-proj`, {
      headers: { Authorization: `Bearer ${token2}` },
    })).json();
    expect(list.map((t) => t.id)).toContain(created.id);

    // Cleanup.
    await fetch(`http://localhost:${TEST_PORT}/api/terminals/${created.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token2}` },
    });
  }, 30000);

  it('1MB of output during a forced restart cycle appears in full on disk', async () => {
    await bootServer();
    const token1 = authenticate();

    const createRes = await fetch(`http://localhost:${TEST_PORT}/api/terminals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token1}` },
      body: JSON.stringify({ projectSlug: 'stress-proj', label: 'CLI' }),
    });
    const created = await createRes.json();

    // Stop the server.
    await stopServer();
    clearSessions();

    // Drive 1MB of output through a side-channel client while no server is
    // attached.
    const { createShellhostClient } = await import('dancode-shellhost/src/client.js');
    const sideClient = createShellhostClient({ socketPath });
    await sideClient.connect();

    // 1MB of 'X' chars. We detect completion by the total bytes that
    // landed on disk across the active + rotation file — using a marker
    // would race against the shell input-echo path (the shell echoes our
    // command back before the heavy command actually finishes).
    await sideClient.write(created.id, "head -c 1000000 /dev/zero | tr '\\0' X\n");

    const logPath = join(tempDir, 'sb', created.id, 'scrollback.log');
    await waitFor(async () => {
      const x = await countXOnDisk(logPath);
      if (x < 1_000_000) throw new Error(`only ${x} X bytes on disk`);
    }, 25_000);

    // Count X's on disk: after a PTY cooked-mode emit of 1,000,000 X's we
    // expect at least ~1,000,000 X bytes in the log (tty layer doesn't change
    // X characters; only newlines get \r\n expansion). Across rotation, that
    // total spans scrollback.log + scrollback.log.1.
    const xCount = await countXOnDisk(logPath);
    expect(xCount).toBeGreaterThanOrEqual(1_000_000);

    sideClient.close();

    // Boot new server; it must recover the terminal.
    await bootServer();
    const token2 = authenticate();
    const list = await (await fetch(`http://localhost:${TEST_PORT}/api/terminals?project=stress-proj`, {
      headers: { Authorization: `Bearer ${token2}` },
    })).json();
    expect(list.map((t) => t.id)).toContain(created.id);

    await fetch(`http://localhost:${TEST_PORT}/api/terminals/${created.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token2}` },
    });
  }, 45000);

  it('POST /api/test-only/kill-server is gated by NODE_ENV=test', async () => {
    await bootServer();
    const token = authenticate();
    const origEnv = process.env.NODE_ENV;
    try {
      // In non-test mode the endpoint is unreachable: requireAuth blocks
      // unauthenticated requests with 401; authenticated ones fall through
      // to the handler which returns 404 to disguise the endpoint.
      process.env.NODE_ENV = 'production';
      const resAuthed = await fetch(`http://localhost:${TEST_PORT}/api/test-only/kill-server`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(resAuthed.status).toBe(404);
      const resUnauthed = await fetch(`http://localhost:${TEST_PORT}/api/test-only/kill-server`, {
        method: 'POST',
      });
      expect(resUnauthed.status).toBe(401);

      process.env.NODE_ENV = 'test';
      // Don't actually let it exit the test runner — patch process.exit just
      // for the duration of this request.
      const realExit = process.exit;
      let exitCalled = false;
      process.exit = (code) => { exitCalled = true; /* swallow */ };
      try {
        const res200 = await fetch(`http://localhost:${TEST_PORT}/api/test-only/kill-server`, {
          method: 'POST',
        });
        expect(res200.status).toBe(200);
        // Give the deferred process.exit a tick to fire.
        await new Promise((r) => setTimeout(r, 50));
        expect(exitCalled).toBe(true);
      } finally {
        process.exit = realExit;
      }
    } finally {
      process.env.NODE_ENV = origEnv;
    }
  }, 15000);
});

async function countXOnDisk(logPath) {
  const { readFile, stat } = await import('node:fs/promises');
  let total = 0;
  for (const p of [logPath, `${logPath}.1`]) {
    try {
      await stat(p);
      const data = await readFile(p, 'utf8');
      let c = 0;
      for (let i = 0; i < data.length; i++) if (data.charCodeAt(i) === 88) c++;
      total += c;
    } catch { /* file may not exist */ }
  }
  return total;
}

async function waitFor(check, timeoutMs) {
  const start = Date.now();
  let lastErr;
  while (Date.now() - start < timeoutMs) {
    try {
      await check();
      return;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw lastErr || new Error('waitFor timeout');
}
