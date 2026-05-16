import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generate } from 'otplib';
import { startServer, terminalManager } from '../src/index.js';
import { clearSessions } from '../src/auth.js';
import { defaultLayout } from '../src/layout.js';

const TEST_PORT = 3098;
const TEST_USERNAME = 'layoutuser';
const TEST_PASSWORD = 'testpassword123';

describe('Layout API endpoints', () => {
  let server;
  let tempDir;
  let credentialsPath;
  let projectsDir;
  let terminalsDir;
  let layoutsDir;
  let token;
  let totpSecret;
  let projectDir;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'dancode-layoutapi-test-'));
    credentialsPath = join(tempDir, 'credentials.json');
    projectsDir = join(tempDir, 'projects');
    terminalsDir = join(tempDir, 'terminals');
    layoutsDir = join(tempDir, 'layouts');
    projectDir = join(tempDir, 'pdir');
    await mkdir(projectDir, { recursive: true });
    await writeFile(join(projectDir, 'present.md'), 'hi');

    server = await startServer(TEST_PORT, {
      credentialsPath,
      projectsDir,
      terminalsDir,
      layoutsBaseDir: layoutsDir,
    });

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
    token = loginData.token;

    // Seed a project config (without going through POST /api/projects which
    // would also try to spawn terminals)
    await mkdir(projectsDir, { recursive: true });
    const project = {
      name: 'Layout API',
      slug: 'layout-api',
      path: projectDir,
      createdAt: '2026-05-15T00:00:00.000Z',
    };
    await writeFile(join(projectsDir, 'layout-api.json'), JSON.stringify(project, null, 2) + '\n');
  });

  afterAll(async () => {
    if (terminalManager?.destroyAll) {
      try { await terminalManager.destroyAll(); } catch {}
    }
    if (server) {
      await new Promise((r) => server.close(r));
    }
    clearSessions();
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  const auth = () => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  });

  it('GET returns default layout when none has been saved', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/api/projects/layout-api/layout`, {
      headers: auth(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ...defaultLayout(), missingFiles: [] });
  });

  it('PUT saves a layout and GET reflects it', async () => {
    const payload = {
      terminals: [{ id: 'a', cwd: '/tmp', command: 'bash', claudeSessionId: null, background: false }],
      openFiles: [{ path: 'present.md', pane: 'p1', scrollTop: 0 }],
      splits: { type: 'leaf', id: 'p1' },
      focusedPane: 'p1',
    };
    const putRes = await fetch(`http://localhost:${TEST_PORT}/api/projects/layout-api/layout`, {
      method: 'PUT',
      headers: auth(),
      body: JSON.stringify(payload),
    });
    expect(putRes.status).toBe(200);

    const getRes = await fetch(`http://localhost:${TEST_PORT}/api/projects/layout-api/layout`, {
      headers: auth(),
    });
    expect(getRes.status).toBe(200);
    expect(await getRes.json()).toEqual({ ...payload, missingFiles: [] });
  });

  it('PUT writes atomically via .tmp + rename', async () => {
    const dir = join(layoutsDir, 'layout-api');
    const files = await readdir(dir);
    expect(files).toContain('layout.json');
    // No tmp files lingering after the PUT
    expect(files.filter((f) => f.includes('.tmp')).length).toBe(0);
  });

  it('PUT rejects unknown top-level fields with 400', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/api/projects/layout-api/layout`, {
      method: 'PUT',
      headers: auth(),
      body: JSON.stringify({ ...defaultLayout(), surprise: 42 }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/unknown/i);
  });

  it('PUT rejects malformed terminal entries with 400', async () => {
    const bad = { ...defaultLayout(), terminals: [{ cwd: '/tmp' }] };
    const res = await fetch(`http://localhost:${TEST_PORT}/api/projects/layout-api/layout`, {
      method: 'PUT',
      headers: auth(),
      body: JSON.stringify(bad),
    });
    expect(res.status).toBe(400);
  });

  it('GET returns 404 for unknown project slug', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/api/projects/does-not-exist/layout`, {
      headers: auth(),
    });
    expect(res.status).toBe(404);
  });

  it('PUT returns 404 for unknown project slug', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/api/projects/does-not-exist/layout`, {
      method: 'PUT',
      headers: auth(),
      body: JSON.stringify(defaultLayout()),
    });
    expect(res.status).toBe(404);
  });

  it('returns 400 for invalid slug shape', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/api/projects/-bad/layout`, {
      headers: auth(),
    });
    expect(res.status).toBe(400);
  });

  it('20 parallel PUTs leave a non-torn file matching one of the inputs', async () => {
    // Seed a second project so this doesn't interfere with the round-trip test
    const project = {
      name: 'Race Project',
      slug: 'race-project',
      path: projectDir,
      createdAt: '2026-05-15T00:00:00.000Z',
    };
    await writeFile(join(projectsDir, 'race-project.json'), JSON.stringify(project, null, 2) + '\n');

    const inputs = [];
    for (let i = 0; i < 20; i++) {
      inputs.push({
        terminals: [{
          id: `t-${i}`,
          cwd: `/tmp/d-${i}`,
          command: 'bash',
          claudeSessionId: null,
          background: false,
        }],
        openFiles: [],
        splits: { type: 'leaf', id: 'root' },
        focusedPane: 'root',
      });
    }
    const responses = await Promise.all(inputs.map((payload) =>
      fetch(`http://localhost:${TEST_PORT}/api/projects/race-project/layout`, {
        method: 'PUT',
        headers: auth(),
        body: JSON.stringify(payload),
      })
    ));
    for (const r of responses) {
      expect(r.status).toBe(200);
    }
    // Parse the on-disk file directly (asserts no torn writes)
    const text = await readFile(join(layoutsDir, 'race-project', 'layout.json'), 'utf-8');
    const parsed = JSON.parse(text); // throws if torn
    const matched = inputs.findIndex((l) => JSON.stringify(l) === JSON.stringify(parsed));
    expect(matched).toBeGreaterThanOrEqual(0);
  });

  it('GET 401 without auth', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/api/projects/layout-api/layout`);
    expect(res.status).toBe(401);
  });

  it('PUT 401 without auth', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/api/projects/layout-api/layout`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(defaultLayout()),
    });
    expect(res.status).toBe(401);
  });

  it('GET annotates missingFiles when openFiles reference files that no longer exist', async () => {
    const payload = {
      ...defaultLayout(),
      openFiles: [
        { path: 'present.md', pane: 'p1', scrollTop: 0 },
        { path: 'gone.md', pane: 'p2', scrollTop: 5 },
      ],
    };
    await fetch(`http://localhost:${TEST_PORT}/api/projects/layout-api/layout`, {
      method: 'PUT',
      headers: auth(),
      body: JSON.stringify(payload),
    });
    const res = await fetch(`http://localhost:${TEST_PORT}/api/projects/layout-api/layout`, {
      headers: auth(),
    });
    const body = await res.json();
    expect(body.openFiles.find((f) => f.path === 'present.md')).toBeTruthy();
    expect(body.openFiles.find((f) => f.path === 'gone.md')).toBeTruthy();
    expect(Array.isArray(body.missingFiles)).toBe(true);
    expect(body.missingFiles.map((f) => f.path)).toEqual(['gone.md']);
  });
});
