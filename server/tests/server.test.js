import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { app, httpServer, startServer } from '../src/index.js';

const execFileAsync = promisify(execFile);

const TEST_PORT = 3099;

describe('DanCode server', () => {
  let server;
  let tempDir;
  let tokenPath;
  let projectsDir;
  let storedToken;
  const createdSessions = [];

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'dancode-server-test-'));
    tokenPath = join(tempDir, 'auth-token');
    projectsDir = join(tempDir, 'projects');
  });

  afterAll(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    // Clean up tmux sessions created during project creation tests
    for (const name of createdSessions) {
      try {
        await execFileAsync('tmux', ['kill-session', '-t', name]);
      } catch {
        // session didn't exist — fine
      }
    }
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('starts and listens on the specified port', async () => {
    server = await startServer(TEST_PORT, { tokenPath, projectsDir });
    storedToken = (await readFile(tokenPath, 'utf-8')).trim();
    const addr = server.address();
    expect(addr.port).toBe(TEST_PORT);
  });

  it('serves a placeholder page with "DanCode" at /', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('DanCode');
    expect(html).toContain('<!DOCTYPE html>');
  });

  it('returns HTML content type for /', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/`);
    expect(res.headers.get('content-type')).toContain('text/html');
  });

  it('uses Solarized Dark background color', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/`);
    const html = await res.text();
    expect(html).toContain('#002b36');
  });

  describe('POST /api/auth/validate', () => {
    it('returns 200 with valid token', async () => {
      const res = await fetch(`http://localhost:${TEST_PORT}/api/auth/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: storedToken }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.valid).toBe(true);
    });

    it('returns 401 with invalid token', async () => {
      const res = await fetch(`http://localhost:${TEST_PORT}/api/auth/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: 'wrong-token' }),
      });
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe('Invalid token');
    });

    it('returns 401 with missing token', async () => {
      const res = await fetch(`http://localhost:${TEST_PORT}/api/auth/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(401);
    });
  });

  describe('REST auth middleware', () => {
    it('returns 401 for API routes with no Authorization header', async () => {
      const res = await fetch(`http://localhost:${TEST_PORT}/api/some-endpoint`);
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe('Missing or invalid authorization header');
    });

    it('returns 401 for API routes with malformed Authorization header', async () => {
      const res = await fetch(`http://localhost:${TEST_PORT}/api/some-endpoint`, {
        headers: { Authorization: 'Token abc123' },
      });
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe('Missing or invalid authorization header');
    });

    it('returns 401 for API routes with invalid Bearer token', async () => {
      const res = await fetch(`http://localhost:${TEST_PORT}/api/some-endpoint`, {
        headers: { Authorization: 'Bearer wrong-token' },
      });
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe('Invalid token');
    });

    it('allows /api/auth/validate without Bearer token', async () => {
      const res = await fetch(`http://localhost:${TEST_PORT}/api/auth/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: storedToken }),
      });
      expect(res.status).toBe(200);
    });

    it('does not require auth for non-API routes', async () => {
      const res = await fetch(`http://localhost:${TEST_PORT}/`);
      expect(res.status).toBe(200);
    });
  });

  describe('POST /api/projects', () => {
    const authHeaders = () => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${storedToken}`,
    });

    it('creates a project with valid inputs', async () => {
      const projectDir = join(tempDir, 'test-project-dir');
      const res = await fetch(`http://localhost:${TEST_PORT}/api/projects`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ name: 'Integration Test', path: projectDir }),
      });
      createdSessions.push('dancode-integration-test');
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.name).toBe('Integration Test');
      expect(body.slug).toBe('integration-test');
      expect(body.path).toBe(projectDir);
      expect(body.createdAt).toBeDefined();
    });

    it('creates the project directory if it does not exist', async () => {
      const projectDir = join(tempDir, 'new-dir-for-project');
      await fetch(`http://localhost:${TEST_PORT}/api/projects`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ name: 'Dir Creator', path: projectDir }),
      });
      createdSessions.push('dancode-dir-creator');
      expect(existsSync(projectDir)).toBe(true);
    });

    it('returns 400 for missing name', async () => {
      const res = await fetch(`http://localhost:${TEST_PORT}/api/projects`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ path: '/tmp/test' }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('name');
    });

    it('returns 400 for missing path', async () => {
      const res = await fetch(`http://localhost:${TEST_PORT}/api/projects`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ name: 'No Path' }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('path');
    });

    it('returns 400 for relative path', async () => {
      const res = await fetch(`http://localhost:${TEST_PORT}/api/projects`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ name: 'Rel Path', path: 'relative/path' }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('absolute');
    });

    it('returns 409 for duplicate project name', async () => {
      await fetch(`http://localhost:${TEST_PORT}/api/projects`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ name: 'Unique Name', path: '/tmp/a' }),
      });
      createdSessions.push('dancode-unique-name');
      const res = await fetch(`http://localhost:${TEST_PORT}/api/projects`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ name: 'Unique Name', path: '/tmp/b' }),
      });
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error).toContain('already exists');
    });

    it('returns 400 when project name would collide with reserved session', async () => {
      // Default DANCODE_TMUX_SESSION is 'dancode-test', so slug 'test' is reserved
      const res = await fetch(`http://localhost:${TEST_PORT}/api/projects`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ name: 'Test', path: '/tmp/reserved-test' }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('reserved');
    });

    it('returns 401 without auth token', async () => {
      const res = await fetch(`http://localhost:${TEST_PORT}/api/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'No Auth', path: '/tmp/test' }),
      });
      expect(res.status).toBe(401);
    });
  });
});
