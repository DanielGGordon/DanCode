import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generate } from 'otplib';
import { app, httpServer, startServer, terminalManager } from '../src/index.js';
import { clearSessions } from '../src/auth.js';

const TEST_PORT = 3099;
const TEST_USERNAME = 'testadmin';
const TEST_PASSWORD = 'testpassword123';

describe('DanCode server', () => {
  let server;
  let tempDir;
  let credentialsPath;
  let projectsDir;
  let terminalsDir;
  let storedToken;
  let totpSecret;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'dancode-server-test-'));
    credentialsPath = join(tempDir, 'credentials.json');
    projectsDir = join(tempDir, 'projects');
    terminalsDir = join(tempDir, 'terminals');
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

  it('starts and listens on the specified port', async () => {
    server = await startServer(TEST_PORT, { credentialsPath, projectsDir, terminalsDir });
    const addr = server.address();
    expect(addr.port).toBe(TEST_PORT);
  });

  it('allows account setup and login', async () => {
    const setupRes = await fetch(`http://localhost:${TEST_PORT}/api/auth/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: TEST_USERNAME, password: TEST_PASSWORD }),
    });
    expect(setupRes.status).toBe(200);
    const setupData = await setupRes.json();
    totpSecret = setupData.totpSecret;
    expect(totpSecret).toBeDefined();
    expect(setupData.qrCodeDataUrl).toMatch(/^data:image\/png;base64,/);

    const totpCode = await generate({ secret: totpSecret });
    const loginRes = await fetch(`http://localhost:${TEST_PORT}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: TEST_USERNAME, password: TEST_PASSWORD, totpCode }),
    });
    expect(loginRes.status).toBe(200);
    const loginData = await loginRes.json();
    storedToken = loginData.token;
    expect(storedToken).toBeDefined();
  });

  it('serves an HTML page with "DanCode" at /', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('DanCode');
    expect(html.toLowerCase()).toContain('<!doctype html>');
  });

  it('returns HTML content type for /', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/`);
    expect(res.headers.get('content-type')).toContain('text/html');
  });

  describe('GET /api/auth/setup/status', () => {
    it('returns setupComplete true after account creation', async () => {
      const res = await fetch(`http://localhost:${TEST_PORT}/api/auth/setup/status`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.setupComplete).toBe(true);
    });
  });

  describe('POST /api/auth/setup', () => {
    it('returns 409 when account already exists', async () => {
      const res = await fetch(`http://localhost:${TEST_PORT}/api/auth/setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'another', password: 'password123' }),
      });
      expect(res.status).toBe(409);
    });
  });

  describe('POST /api/auth/login', () => {
    it('returns 401 with wrong password', async () => {
      const code = await generate({ secret: totpSecret });
      const res = await fetch(`http://localhost:${TEST_PORT}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: TEST_USERNAME, password: 'wrongpass', totpCode: code }),
      });
      expect(res.status).toBe(401);
    });

    it('returns 401 with wrong TOTP code', async () => {
      const res = await fetch(`http://localhost:${TEST_PORT}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: TEST_USERNAME, password: TEST_PASSWORD, totpCode: '000000' }),
      });
      expect(res.status).toBe(401);
    });

    it('returns 400 with missing fields', async () => {
      const res = await fetch(`http://localhost:${TEST_PORT}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: TEST_USERNAME }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/auth/validate', () => {
    it('returns 200 with valid session token', async () => {
      const res = await fetch(`http://localhost:${TEST_PORT}/api/auth/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: storedToken }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.valid).toBe(true);
    });

    it('returns 401 with invalid session token', async () => {
      const res = await fetch(`http://localhost:${TEST_PORT}/api/auth/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: 'not-a-real-session' }),
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

    it('allows auth endpoints without Bearer token', async () => {
      const res = await fetch(`http://localhost:${TEST_PORT}/api/auth/setup/status`);
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

    it('creates a project with valid inputs and 2 default terminals', async () => {
      const projectDir = join(tempDir, 'test-project-dir');
      const res = await fetch(`http://localhost:${TEST_PORT}/api/projects`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ name: 'Integration Test', path: projectDir }),
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.name).toBe('Integration Test');
      expect(body.slug).toBe('integration-test');
      expect(body.path).toBe(projectDir);
      expect(body.createdAt).toBeDefined();
      // Should have 2 default terminal IDs
      expect(Array.isArray(body.terminals)).toBe(true);
      expect(body.terminals).toHaveLength(2);
      // Should have layout config
      expect(body.layout).toBeDefined();
      expect(body.layout.mode).toBe('split');
    });

    it('creates CLI and Claude terminals for the project', async () => {
      const res = await fetch(`http://localhost:${TEST_PORT}/api/terminals?project=integration-test`, {
        headers: { Authorization: `Bearer ${storedToken}` },
      });
      expect(res.status).toBe(200);
      const terminals = await res.json();
      expect(terminals).toHaveLength(2);
      const labels = terminals.map((t) => t.label);
      expect(labels).toContain('CLI');
      expect(labels).toContain('Claude');
    });

    it('creates the project directory if it does not exist', async () => {
      const projectDir = join(tempDir, 'new-dir-for-project');
      await fetch(`http://localhost:${TEST_PORT}/api/projects`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ name: 'Dir Creator', path: projectDir }),
      });
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
      const res = await fetch(`http://localhost:${TEST_PORT}/api/projects`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ name: 'Unique Name', path: '/tmp/b' }),
      });
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error).toContain('already exists');
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

  describe('DELETE /api/projects/:slug', () => {
    const authHeaders = () => ({
      Authorization: `Bearer ${storedToken}`,
    });

    it('deletes an existing project and returns 204', async () => {
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

    const seededProjects = [
      { name: 'Alpha Project', slug: 'alpha-project', path: '/tmp/alpha', createdAt: '2025-01-01T00:00:00.000Z' },
      { name: 'Beta Project', slug: 'beta-project', path: '/tmp/beta', createdAt: '2025-01-02T00:00:00.000Z' },
      { name: 'Gamma Project', slug: 'gamma-project', path: '/tmp/gamma', createdAt: '2025-01-03T00:00:00.000Z' },
    ];

    beforeAll(async () => {
      const { readdir, rm: rmFile } = await import('node:fs/promises');
      const files = await readdir(projectsDir).catch(() => []);
      for (const f of files) {
        await rmFile(join(projectsDir, f));
      }
      const { mkdir } = await import('node:fs/promises');
      await mkdir(projectsDir, { recursive: true });
      for (const p of seededProjects) {
        await writeFile(join(projectsDir, `${p.slug}.json`), JSON.stringify(p, null, 2) + '\n');
      }
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
      const res = await fetch(`http://localhost:${TEST_PORT}/api/projects`, {
        headers: authHeaders(),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.length).toBe(3);
    });

    it('returns 401 without auth token', async () => {
      const res = await fetch(`http://localhost:${TEST_PORT}/api/projects`);
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
        body: JSON.stringify({ layout: { mode: 'tabs', activeTab: 1 } }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.slug).toBe('alpha-project');
      expect(body.layout).toEqual({ mode: 'tabs', activeTab: 1 });
    });

    it('persists layout so GET returns updated data', async () => {
      await fetch(`http://localhost:${TEST_PORT}/api/projects/beta-project`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ layout: { mode: 'split', activeTab: 0 } }),
      });
      const res = await fetch(`http://localhost:${TEST_PORT}/api/projects/beta-project`, {
        headers: { Authorization: `Bearer ${storedToken}` },
      });
      const body = await res.json();
      expect(body.layout).toEqual({ mode: 'split', activeTab: 0 });
    });

    it('updates terminals array', async () => {
      const res = await fetch(`http://localhost:${TEST_PORT}/api/projects/alpha-project`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ terminals: ['id-1', 'id-2', 'id-3'] }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.terminals).toEqual(['id-1', 'id-2', 'id-3']);
    });

    it('accepts layout and terminals together', async () => {
      const res = await fetch(`http://localhost:${TEST_PORT}/api/projects/alpha-project`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ layout: { mode: 'split' }, terminals: ['a', 'b'] }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.layout.mode).toBe('split');
      expect(body.terminals).toEqual(['a', 'b']);
    });

    it('returns 400 without valid fields', async () => {
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
