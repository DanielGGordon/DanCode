import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
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

    describe('adopt mode', () => {
      const ADOPT_SESSION = 'adopt-test-session';

      beforeAll(async () => {
        try {
          await execFileAsync('tmux', ['new-session', '-d', '-s', ADOPT_SESSION]);
        } catch {
          // already exists
        }
      });

      afterAll(async () => {
        try {
          await execFileAsync('tmux', ['kill-session', '-t', ADOPT_SESSION]);
        } catch {
          // already gone
        }
      });

      it('creates a project linked to an existing tmux session', async () => {
        const res = await fetch(`http://localhost:${TEST_PORT}/api/projects`, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ name: 'Adopted Project', adoptSession: ADOPT_SESSION }),
        });
        expect(res.status).toBe(201);
        const body = await res.json();
        expect(body.name).toBe('Adopted Project');
        expect(body.slug).toBe('adopted-project');
        expect(body.tmuxSession).toBe(ADOPT_SESSION);
        expect(body.path).toBeUndefined();
      });

      it('does not create a new tmux session (no dancode-* session)', async () => {
        const { stdout } = await execFileAsync('tmux', [
          'list-sessions', '-F', '#{session_name}',
        ]);
        const sessions = stdout.trim().split('\n');
        expect(sessions).not.toContain('dancode-adopted-project');
      });

      it('returns 400 when adopted session does not exist', async () => {
        const res = await fetch(`http://localhost:${TEST_PORT}/api/projects`, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ name: 'Ghost', adoptSession: 'nonexistent-session' }),
        });
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toContain('does not exist');
      });

      it('returns 400 when name is missing in adopt mode', async () => {
        const res = await fetch(`http://localhost:${TEST_PORT}/api/projects`, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ adoptSession: ADOPT_SESSION }),
        });
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toContain('name');
      });

      it('returns 409 for duplicate project name in adopt mode', async () => {
        const res = await fetch(`http://localhost:${TEST_PORT}/api/projects`, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ name: 'Adopted Project', adoptSession: ADOPT_SESSION }),
        });
        expect(res.status).toBe(409);
        const body = await res.json();
        expect(body.error).toContain('already exists');
      });
    });
  });

  describe('DELETE /api/projects/:slug', () => {
    const authHeaders = () => ({
      Authorization: `Bearer ${storedToken}`,
    });

    it('deletes an existing project and returns 204', async () => {
      // Seed a project config directly
      const { mkdir } = await import('node:fs/promises');
      await mkdir(projectsDir, { recursive: true });
      const project = { name: 'Delete Me', slug: 'delete-me', path: '/tmp/del', createdAt: '2025-01-01T00:00:00.000Z' };
      await writeFile(join(projectsDir, 'delete-me.json'), JSON.stringify(project, null, 2) + '\n');

      const res = await fetch(`http://localhost:${TEST_PORT}/api/projects/delete-me`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      expect(res.status).toBe(204);
      expect(existsSync(join(projectsDir, 'delete-me.json'))).toBe(false);
    });

    it('returns 404 for non-existent project', async () => {
      const res = await fetch(`http://localhost:${TEST_PORT}/api/projects/nonexistent`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toContain('not found');
    });

    it('returns 401 without auth token', async () => {
      const res = await fetch(`http://localhost:${TEST_PORT}/api/projects/some-slug`, {
        method: 'DELETE',
      });
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/projects', () => {
    const authHeaders = () => ({
      Authorization: `Bearer ${storedToken}`,
    });

    // Seed test data directly into the projects dir so this block is self-contained
    const seededProjects = [
      { name: 'Alpha Project', slug: 'alpha-project', path: '/tmp/alpha', createdAt: '2025-01-01T00:00:00.000Z' },
      { name: 'Beta Project', slug: 'beta-project', path: '/tmp/beta', createdAt: '2025-01-02T00:00:00.000Z' },
      { name: 'Gamma Project', slug: 'gamma-project', path: '/tmp/gamma', createdAt: '2025-01-03T00:00:00.000Z' },
    ];

    beforeAll(async () => {
      // Clear any configs left by earlier tests
      const { readdir, rm: rmFile } = await import('node:fs/promises');
      const files = await readdir(projectsDir).catch(() => []);
      for (const f of files) {
        await rmFile(join(projectsDir, f));
      }
      // Write known fixtures
      const { mkdir } = await import('node:fs/promises');
      await mkdir(projectsDir, { recursive: true });
      for (const p of seededProjects) {
        await writeFile(join(projectsDir, `${p.slug}.json`), JSON.stringify(p, null, 2) + '\n');
      }
      // Also write a malformed config to verify tolerance
      await writeFile(join(projectsDir, 'broken.json'), '{invalid json!!!');
    });

    it('returns a list of configured projects', async () => {
      const res = await fetch(`http://localhost:${TEST_PORT}/api/projects`, {
        headers: authHeaders(),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBe(3);
      const slugs = body.map((p) => p.slug);
      expect(slugs).toContain('alpha-project');
      expect(slugs).toContain('beta-project');
      expect(slugs).toContain('gamma-project');
    });

    it('returns projects sorted alphabetically by name', async () => {
      const res = await fetch(`http://localhost:${TEST_PORT}/api/projects`, {
        headers: authHeaders(),
      });
      const body = await res.json();
      const names = body.map((p) => p.name);
      const sorted = [...names].sort((a, b) => a.localeCompare(b));
      expect(names).toEqual(sorted);
    });

    it('returns projects with expected fields', async () => {
      const res = await fetch(`http://localhost:${TEST_PORT}/api/projects`, {
        headers: authHeaders(),
      });
      const body = await res.json();
      for (const project of body) {
        expect(project).toHaveProperty('name');
        expect(project).toHaveProperty('slug');
        expect(project).toHaveProperty('path');
        expect(project).toHaveProperty('createdAt');
      }
    });

    it('skips malformed config files instead of failing', async () => {
      // broken.json was written in beforeAll — endpoint should still succeed
      const res = await fetch(`http://localhost:${TEST_PORT}/api/projects`, {
        headers: authHeaders(),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      // Only the 3 valid projects should appear
      expect(body.length).toBe(3);
    });

    it('returns 401 without auth token', async () => {
      const res = await fetch(`http://localhost:${TEST_PORT}/api/projects`);
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/tmux-status', () => {
    const authHeaders = () => ({
      Authorization: `Bearer ${storedToken}`,
    });

    it('returns an object mapping slugs to booleans', async () => {
      const res = await fetch(`http://localhost:${TEST_PORT}/api/tmux-status`, {
        headers: authHeaders(),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(typeof body).toBe('object');
      expect(Array.isArray(body)).toBe(false);
      // Each value should be a boolean
      for (const val of Object.values(body)) {
        expect(typeof val).toBe('boolean');
      }
    });

    it('includes all configured project slugs', async () => {
      const res = await fetch(`http://localhost:${TEST_PORT}/api/tmux-status`, {
        headers: authHeaders(),
      });
      const body = await res.json();
      const slugs = Object.keys(body);
      expect(slugs).toContain('alpha-project');
      expect(slugs).toContain('beta-project');
      expect(slugs).toContain('gamma-project');
    });

    it('returns 401 without auth token', async () => {
      const res = await fetch(`http://localhost:${TEST_PORT}/api/tmux-status`);
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/tmux/sessions', () => {
    const authHeaders = () => ({
      Authorization: `Bearer ${storedToken}`,
    });

    const ORPHAN_SESSION = 'orphan-test-session';

    beforeAll(async () => {
      // Create an orphan tmux session (not mapped to any project)
      try {
        await execFileAsync('tmux', ['new-session', '-d', '-s', ORPHAN_SESSION]);
      } catch {
        // already exists
      }
    });

    afterAll(async () => {
      try {
        await execFileAsync('tmux', ['kill-session', '-t', ORPHAN_SESSION]);
      } catch {
        // already gone
      }
    });

    it('returns an array of orphaned tmux sessions', async () => {
      const res = await fetch(`http://localhost:${TEST_PORT}/api/tmux/sessions`, {
        headers: authHeaders(),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
      // Each entry should have a name property
      for (const session of body) {
        expect(session).toHaveProperty('name');
        expect(typeof session.name).toBe('string');
      }
    });

    it('includes sessions not mapped to any project', async () => {
      const res = await fetch(`http://localhost:${TEST_PORT}/api/tmux/sessions`, {
        headers: authHeaders(),
      });
      const body = await res.json();
      const names = body.map((s) => s.name);
      expect(names).toContain(ORPHAN_SESSION);
    });

    it('excludes sessions that are mapped to a configured project', async () => {
      // Create a project session so it appears in tmux
      await execFileAsync('tmux', ['new-session', '-d', '-s', 'dancode-alpha-project']).catch(() => {});
      try {
        const res = await fetch(`http://localhost:${TEST_PORT}/api/tmux/sessions`, {
          headers: authHeaders(),
        });
        const body = await res.json();
        const names = body.map((s) => s.name);
        expect(names).not.toContain('dancode-alpha-project');
      } finally {
        await execFileAsync('tmux', ['kill-session', '-t', 'dancode-alpha-project']).catch(() => {});
      }
    });

    it('excludes connection sessions (containing -conn-)', async () => {
      // Create a connection-style session
      await execFileAsync('tmux', ['new-session', '-d', '-s', 'something-conn-abc']).catch(() => {});
      try {
        const res = await fetch(`http://localhost:${TEST_PORT}/api/tmux/sessions`, {
          headers: authHeaders(),
        });
        const body = await res.json();
        const names = body.map((s) => s.name);
        expect(names).not.toContain('something-conn-abc');
      } finally {
        await execFileAsync('tmux', ['kill-session', '-t', 'something-conn-abc']).catch(() => {});
      }
    });

    it('returns 401 without auth token', async () => {
      const res = await fetch(`http://localhost:${TEST_PORT}/api/tmux/sessions`);
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/projects/:slug', () => {
    const authHeaders = () => ({
      Authorization: `Bearer ${storedToken}`,
    });

    it('returns a single project by slug', async () => {
      const res = await fetch(`http://localhost:${TEST_PORT}/api/projects/alpha-project`, {
        headers: authHeaders(),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.name).toBe('Alpha Project');
      expect(body.slug).toBe('alpha-project');
    });

    it('returns 404 for non-existent project', async () => {
      const res = await fetch(`http://localhost:${TEST_PORT}/api/projects/nonexistent`, {
        headers: authHeaders(),
      });
      expect(res.status).toBe(404);
    });

    it('returns 400 for invalid slug', async () => {
      const res = await fetch(`http://localhost:${TEST_PORT}/api/projects/-leading-hyphen`, {
        headers: authHeaders(),
      });
      expect(res.status).toBe(400);
    });

    it('returns 401 without auth token', async () => {
      const res = await fetch(`http://localhost:${TEST_PORT}/api/projects/alpha-project`);
      expect(res.status).toBe(401);
    });
  });

  describe('PATCH /api/projects/:slug', () => {
    const authHeaders = () => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${storedToken}`,
    });

    it('updates layout preferences and returns updated project', async () => {
      const res = await fetch(`http://localhost:${TEST_PORT}/api/projects/alpha-project`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ layout: { mode: 'tabs', hiddenPanes: [2] } }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.slug).toBe('alpha-project');
      expect(body.layout).toEqual({ mode: 'tabs', hiddenPanes: [2] });
    });

    it('persists layout so GET returns updated data', async () => {
      await fetch(`http://localhost:${TEST_PORT}/api/projects/beta-project`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ layout: { mode: 'split', hiddenPanes: [1] } }),
      });
      const res = await fetch(`http://localhost:${TEST_PORT}/api/projects/beta-project`, {
        headers: { Authorization: `Bearer ${storedToken}` },
      });
      const body = await res.json();
      expect(body.layout).toEqual({ mode: 'split', hiddenPanes: [1] });
    });

    it('returns 400 without layout object', async () => {
      const res = await fetch(`http://localhost:${TEST_PORT}/api/projects/alpha-project`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ something: 'else' }),
      });
      expect(res.status).toBe(400);
    });

    it('returns 404 for non-existent project', async () => {
      const res = await fetch(`http://localhost:${TEST_PORT}/api/projects/nonexistent`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ layout: { mode: 'tabs' } }),
      });
      expect(res.status).toBe(404);
    });

    it('returns 401 without auth token', async () => {
      const res = await fetch(`http://localhost:${TEST_PORT}/api/projects/alpha-project`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ layout: { mode: 'tabs' } }),
      });
      expect(res.status).toBe(401);
    });
  });
});
