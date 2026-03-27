import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { mkdtemp, readFile, rm, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { generate } from 'otplib';
import { io as ioClient } from 'socket.io-client';
import { startServer, httpServer, terminalManager } from '../src/index.js';
import { clearSessions } from '../src/auth.js';

const execFileAsync = promisify(execFile);

const TEST_PORT = 3098;
const TEST_USERNAME = 'testadmin';
const TEST_PASSWORD = 'testpassword123';

describe('Terminal Manager', () => {
  let server;
  let tempDir;
  let terminalsDir;
  let storedToken;
  let totpSecret;

  const authHeaders = () => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${storedToken}`,
  });

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'dancode-tm-test-'));
    terminalsDir = join(tempDir, 'terminals');

    server = await startServer(TEST_PORT, {
      credentialsPath: join(tempDir, 'credentials.json'),
      projectsDir: join(tempDir, 'projects'),
      terminalsDir,
    });

    // Set up auth
    const setupRes = await fetch(`http://localhost:${TEST_PORT}/api/auth/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: TEST_USERNAME, password: TEST_PASSWORD }),
    });
    const setupData = await setupRes.json();
    totpSecret = setupData.totpSecret;

    const totpCode = await generate({ secret: totpSecret });
    const loginRes = await fetch(`http://localhost:${TEST_PORT}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: TEST_USERNAME, password: TEST_PASSWORD, totpCode }),
    });
    const loginData = await loginRes.json();
    storedToken = loginData.token;
  });

  afterAll(async () => {
    if (terminalManager) {
      await terminalManager.destroyAll();
    }
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    clearSessions();
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  describe('POST /api/terminals', () => {
    it('creates a terminal with projectSlug and label', async () => {
      const res = await fetch(`http://localhost:${TEST_PORT}/api/terminals`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ projectSlug: 'test-project', label: 'CLI' }),
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.id).toBeDefined();
      expect(body.projectSlug).toBe('test-project');
      expect(body.label).toBe('CLI');
      expect(body.createdAt).toBeDefined();

      // Cleanup
      await terminalManager.destroy(body.id);
    });

    it('returns 400 without projectSlug', async () => {
      const res = await fetch(`http://localhost:${TEST_PORT}/api/terminals`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ label: 'No Slug' }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('projectSlug');
    });

    it('returns 401 without auth token', async () => {
      const res = await fetch(`http://localhost:${TEST_PORT}/api/terminals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectSlug: 'test', label: 'Test' }),
      });
      expect(res.status).toBe(401);
    });

    it('defaults label to Terminal when not provided', async () => {
      const res = await fetch(`http://localhost:${TEST_PORT}/api/terminals`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ projectSlug: 'test-project' }),
      });
      const body = await res.json();
      expect(body.label).toBe('Terminal');

      await terminalManager.destroy(body.id);
    });
  });

  describe('GET /api/terminals', () => {
    let terminalId1, terminalId2;

    beforeAll(async () => {
      const res1 = await fetch(`http://localhost:${TEST_PORT}/api/terminals`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ projectSlug: 'proj-a', label: 'CLI' }),
      });
      terminalId1 = (await res1.json()).id;

      const res2 = await fetch(`http://localhost:${TEST_PORT}/api/terminals`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ projectSlug: 'proj-b', label: 'Claude' }),
      });
      terminalId2 = (await res2.json()).id;
    });

    afterAll(async () => {
      await terminalManager.destroy(terminalId1);
      await terminalManager.destroy(terminalId2);
    });

    it('returns all terminals when no project filter', async () => {
      const res = await fetch(`http://localhost:${TEST_PORT}/api/terminals`, {
        headers: { Authorization: `Bearer ${storedToken}` },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBeGreaterThanOrEqual(2);
    });

    it('filters by project query param', async () => {
      const res = await fetch(`http://localhost:${TEST_PORT}/api/terminals?project=proj-a`, {
        headers: { Authorization: `Bearer ${storedToken}` },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.every((t) => t.projectSlug === 'proj-a')).toBe(true);
      expect(body.some((t) => t.id === terminalId1)).toBe(true);
    });

    it('returns empty array for unknown project', async () => {
      const res = await fetch(`http://localhost:${TEST_PORT}/api/terminals?project=nonexistent`, {
        headers: { Authorization: `Bearer ${storedToken}` },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual([]);
    });

    it('returns 401 without auth token', async () => {
      const res = await fetch(`http://localhost:${TEST_PORT}/api/terminals`);
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/terminals/:id', () => {
    let terminalId;

    beforeAll(async () => {
      const res = await fetch(`http://localhost:${TEST_PORT}/api/terminals`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ projectSlug: 'get-test', label: 'Get Test' }),
      });
      terminalId = (await res.json()).id;
    });

    afterAll(async () => {
      await terminalManager.destroy(terminalId);
    });

    it('returns a single terminal by id', async () => {
      const res = await fetch(`http://localhost:${TEST_PORT}/api/terminals/${terminalId}`, {
        headers: { Authorization: `Bearer ${storedToken}` },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.id).toBe(terminalId);
      expect(body.projectSlug).toBe('get-test');
      expect(body.label).toBe('Get Test');
      expect(body.createdAt).toBeDefined();
    });

    it('returns 404 for non-existent terminal', async () => {
      const res = await fetch(`http://localhost:${TEST_PORT}/api/terminals/00000000-0000-0000-0000-000000000000`, {
        headers: { Authorization: `Bearer ${storedToken}` },
      });
      expect(res.status).toBe(404);
    });

    it('returns 401 without auth token', async () => {
      const res = await fetch(`http://localhost:${TEST_PORT}/api/terminals/${terminalId}`);
      expect(res.status).toBe(401);
    });
  });

  describe('PATCH /api/terminals/:id', () => {
    let terminalId;

    beforeAll(async () => {
      const res = await fetch(`http://localhost:${TEST_PORT}/api/terminals`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ projectSlug: 'patch-test', label: 'Original' }),
      });
      terminalId = (await res.json()).id;
    });

    afterAll(async () => {
      await terminalManager.destroy(terminalId);
    });

    it('updates the terminal label', async () => {
      const res = await fetch(`http://localhost:${TEST_PORT}/api/terminals/${terminalId}`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ label: 'Updated Label' }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.label).toBe('Updated Label');
    });

    it('persists updated label', async () => {
      const res = await fetch(`http://localhost:${TEST_PORT}/api/terminals/${terminalId}`, {
        headers: { Authorization: `Bearer ${storedToken}` },
      });
      const body = await res.json();
      expect(body.label).toBe('Updated Label');
    });

    it('returns 400 without label', async () => {
      const res = await fetch(`http://localhost:${TEST_PORT}/api/terminals/${terminalId}`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ something: 'else' }),
      });
      expect(res.status).toBe(400);
    });

    it('returns 404 for non-existent terminal', async () => {
      const res = await fetch(`http://localhost:${TEST_PORT}/api/terminals/00000000-0000-0000-0000-000000000000`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ label: 'New' }),
      });
      expect(res.status).toBe(404);
    });

    it('returns 401 without auth token', async () => {
      const res = await fetch(`http://localhost:${TEST_PORT}/api/terminals/${terminalId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: 'No Auth' }),
      });
      expect(res.status).toBe(401);
    });
  });

  describe('DELETE /api/terminals/:id', () => {
    it('deletes a terminal and returns 204', async () => {
      const createRes = await fetch(`http://localhost:${TEST_PORT}/api/terminals`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ projectSlug: 'delete-test', label: 'Delete Me' }),
      });
      const { id } = await createRes.json();

      const res = await fetch(`http://localhost:${TEST_PORT}/api/terminals/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${storedToken}` },
      });
      expect(res.status).toBe(204);

      // Verify it's gone
      const getRes = await fetch(`http://localhost:${TEST_PORT}/api/terminals/${id}`, {
        headers: { Authorization: `Bearer ${storedToken}` },
      });
      expect(getRes.status).toBe(404);
    });

    it('returns 404 for non-existent terminal', async () => {
      const res = await fetch(`http://localhost:${TEST_PORT}/api/terminals/00000000-0000-0000-0000-000000000000`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${storedToken}` },
      });
      expect(res.status).toBe(404);
    });

    it('returns 401 without auth token', async () => {
      const res = await fetch(`http://localhost:${TEST_PORT}/api/terminals/some-id`, {
        method: 'DELETE',
      });
      expect(res.status).toBe(401);
    });
  });

  describe('metadata persistence', () => {
    it('writes metadata JSON on creation', async () => {
      const createRes = await fetch(`http://localhost:${TEST_PORT}/api/terminals`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ projectSlug: 'meta-test', label: 'Metadata' }),
      });
      const { id } = await createRes.json();

      const metaPath = join(terminalsDir, `${id}.json`);
      expect(existsSync(metaPath)).toBe(true);

      const meta = JSON.parse(await readFile(metaPath, 'utf-8'));
      expect(meta.id).toBe(id);
      expect(meta.projectSlug).toBe('meta-test');
      expect(meta.label).toBe('Metadata');
      expect(meta.createdAt).toBeDefined();

      await terminalManager.destroy(id);
    });

    it('removes metadata JSON on deletion', async () => {
      const createRes = await fetch(`http://localhost:${TEST_PORT}/api/terminals`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ projectSlug: 'meta-delete', label: 'Delete Meta' }),
      });
      const { id } = await createRes.json();

      const metaPath = join(terminalsDir, `${id}.json`);
      expect(existsSync(metaPath)).toBe(true);

      await fetch(`http://localhost:${TEST_PORT}/api/terminals/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${storedToken}` },
      });

      expect(existsSync(metaPath)).toBe(false);
    });

    it('updates metadata JSON on label change', async () => {
      const createRes = await fetch(`http://localhost:${TEST_PORT}/api/terminals`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ projectSlug: 'meta-update', label: 'Before' }),
      });
      const { id } = await createRes.json();

      await fetch(`http://localhost:${TEST_PORT}/api/terminals/${id}`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ label: 'After' }),
      });

      const meta = JSON.parse(await readFile(join(terminalsDir, `${id}.json`), 'utf-8'));
      expect(meta.label).toBe('After');

      await terminalManager.destroy(id);
    });
  });

  describe('WebSocket /terminal/:id', () => {
    let terminalId;

    beforeAll(async () => {
      const res = await fetch(`http://localhost:${TEST_PORT}/api/terminals`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ projectSlug: 'ws-test', label: 'WS Test' }),
      });
      terminalId = (await res.json()).id;
    });

    afterAll(async () => {
      await terminalManager.destroy(terminalId);
    });

    it('rejects connections without auth token', async () => {
      const socket = ioClient(`http://localhost:${TEST_PORT}/terminal/${terminalId}`, {
        forceNew: true,
        transports: ['websocket'],
        auth: {},
      });

      const error = await new Promise((resolve) => socket.on('connect_error', resolve));
      expect(error.message).toBe('Authentication failed');
      socket.disconnect();
    });

    it('rejects connections with invalid auth token', async () => {
      const socket = ioClient(`http://localhost:${TEST_PORT}/terminal/${terminalId}`, {
        forceNew: true,
        transports: ['websocket'],
        auth: { token: 'invalid-token' },
      });

      const error = await new Promise((resolve) => socket.on('connect_error', resolve));
      expect(error.message).toBe('Authentication failed');
      socket.disconnect();
    });

    it('streams PTY output to connected socket', async () => {
      const socket = ioClient(`http://localhost:${TEST_PORT}/terminal/${terminalId}`, {
        forceNew: true,
        transports: ['websocket'],
        auth: { token: storedToken },
      });

      await new Promise((resolve) => socket.on('connect', resolve));

      // Send a command and wait for output
      const outputPromise = new Promise((resolve) => {
        let buffer = '';
        socket.on('output', (data) => {
          buffer += data;
          if (buffer.includes('ws-test-marker')) {
            resolve(buffer);
          }
        });
      });

      socket.emit('input', 'echo ws-test-marker\n');

      const output = await outputPromise;
      expect(output).toContain('ws-test-marker');

      socket.disconnect();
    });

    it('accepts input from socket and writes to PTY', async () => {
      const socket = ioClient(`http://localhost:${TEST_PORT}/terminal/${terminalId}`, {
        forceNew: true,
        transports: ['websocket'],
        auth: { token: storedToken },
      });

      await new Promise((resolve) => socket.on('connect', resolve));

      const outputPromise = new Promise((resolve) => {
        let buffer = '';
        socket.on('output', (data) => {
          buffer += data;
          if (buffer.includes('input-works')) {
            resolve(buffer);
          }
        });
      });

      socket.emit('input', 'echo input-works\n');

      const output = await outputPromise;
      expect(output).toContain('input-works');

      socket.disconnect();
    });

    it('resizes the PTY on resize events', async () => {
      const socket = ioClient(`http://localhost:${TEST_PORT}/terminal/${terminalId}`, {
        forceNew: true,
        transports: ['websocket'],
        auth: { token: storedToken },
      });

      await new Promise((resolve) => socket.on('connect', resolve));

      // Send resize
      socket.emit('resize', { cols: 132, rows: 43 });

      // Give resize a moment to propagate through tmux
      await new Promise((r) => setTimeout(r, 500));

      // Verify resize via tmux API (tmux rendering splits text with escape sequences,
      // making stty size output undetectable via simple string matching)
      const tmuxName = terminalManager.getTmuxSessionName(terminalId);
      expect(tmuxName).toBeTruthy();

      const { stdout } = await execFileAsync('tmux', [
        'display-message', '-t', tmuxName, '-p', '#{pane_width}x#{pane_height}',
      ]);
      expect(stdout.trim()).toBe('132x43');

      socket.disconnect();
    });
  });

  describe('PTY persistence across disconnects', () => {
    it('keeps PTY alive when WebSocket disconnects', async () => {
      const createRes = await fetch(`http://localhost:${TEST_PORT}/api/terminals`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ projectSlug: 'persist-test', label: 'Persist' }),
      });
      const { id } = await createRes.json();

      // Connect and run a command
      const socket1 = ioClient(`http://localhost:${TEST_PORT}/terminal/${id}`, {
        forceNew: true,
        transports: ['websocket'],
        auth: { token: storedToken },
      });

      await new Promise((resolve) => socket1.on('connect', resolve));

      // Write something unique to the terminal
      const outputPromise1 = new Promise((resolve) => {
        let buffer = '';
        socket1.on('output', (data) => {
          buffer += data;
          if (buffer.includes('persist-marker')) {
            resolve(buffer);
          }
        });
      });

      socket1.emit('input', 'echo persist-marker\n');
      await outputPromise1;

      // Disconnect
      socket1.disconnect();
      await new Promise((r) => setTimeout(r, 300));

      // Terminal should still exist
      const getRes = await fetch(`http://localhost:${TEST_PORT}/api/terminals/${id}`, {
        headers: { Authorization: `Bearer ${storedToken}` },
      });
      expect(getRes.status).toBe(200);

      await terminalManager.destroy(id);
    });
  });

  describe('reconnection ring buffer replay', () => {
    it('replays buffered output on reconnect', async () => {
      const createRes = await fetch(`http://localhost:${TEST_PORT}/api/terminals`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ projectSlug: 'replay-test', label: 'Replay' }),
      });
      const { id } = await createRes.json();

      // First connection: send a command
      const socket1 = ioClient(`http://localhost:${TEST_PORT}/terminal/${id}`, {
        forceNew: true,
        transports: ['websocket'],
        auth: { token: storedToken },
      });

      await new Promise((resolve) => socket1.on('connect', resolve));

      const outputPromise1 = new Promise((resolve) => {
        let buffer = '';
        socket1.on('output', (data) => {
          buffer += data;
          if (buffer.includes('replay-marker')) {
            resolve(buffer);
          }
        });
      });

      socket1.emit('input', 'echo replay-marker\n');
      await outputPromise1;

      // Disconnect first socket
      socket1.disconnect();
      await new Promise((r) => setTimeout(r, 300));

      // Reconnect with a new socket
      const socket2 = ioClient(`http://localhost:${TEST_PORT}/terminal/${id}`, {
        forceNew: true,
        transports: ['websocket'],
        auth: { token: storedToken },
      });

      // The ring buffer replay should contain the previous output
      const replayedOutput = await new Promise((resolve) => {
        let buffer = '';
        socket2.on('output', (data) => {
          buffer += data;
          // Wait briefly then resolve with whatever we have
        });
        setTimeout(() => resolve(buffer), 1000);
      });

      expect(replayedOutput).toContain('replay-marker');

      socket2.disconnect();
      await terminalManager.destroy(id);
    });
  });

  describe('command execution on creation', () => {
    it('executes command param after spawn', async () => {
      const createRes = await fetch(`http://localhost:${TEST_PORT}/api/terminals`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ projectSlug: 'cmd-test', label: 'Cmd', command: 'echo cmd-executed' }),
      });
      const { id } = await createRes.json();

      // Connect and check output includes the command result
      const socket = ioClient(`http://localhost:${TEST_PORT}/terminal/${id}`, {
        forceNew: true,
        transports: ['websocket'],
        auth: { token: storedToken },
      });

      const output = await new Promise((resolve) => {
        let buffer = '';
        socket.on('output', (data) => {
          buffer += data;
          if (buffer.includes('cmd-executed')) {
            resolve(buffer);
          }
        });
        // Timeout after 5s
        setTimeout(() => resolve(buffer), 5000);
      });

      expect(output).toContain('cmd-executed');

      socket.disconnect();
      await terminalManager.destroy(id);
    });
  });
});
