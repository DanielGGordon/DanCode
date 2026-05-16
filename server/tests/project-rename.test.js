import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generate } from 'otplib';
import { startServer, terminalManager } from '../src/index.js';
import { clearSessions } from '../src/auth.js';
import { defaultLayout } from '../src/layout.js';

const TEST_PORT = 3096;
const TEST_USERNAME = 'rename-user';
const TEST_PASSWORD = 'testpassword123';

describe('PATCH /api/projects/:slug renaming', () => {
  let server;
  let tempDir;
  let credentialsPath;
  let projectsDir;
  let terminalsDir;
  let layoutsDir;
  let token;
  let projectDir;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'dancode-rename-test-'));
    credentialsPath = join(tempDir, 'credentials.json');
    projectsDir = join(tempDir, 'projects');
    terminalsDir = join(tempDir, 'terminals');
    layoutsDir = join(tempDir, 'layouts');
    projectDir = join(tempDir, 'pdir');
    await mkdir(projectDir, { recursive: true });

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
    const { totpSecret } = await setupRes.json();
    const totpCode = await generate({ secret: totpSecret });
    const loginRes = await fetch(`http://localhost:${TEST_PORT}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: TEST_USERNAME, password: TEST_PASSWORD, totpCode }),
    });
    token = (await loginRes.json()).token;
  });

  afterAll(async () => {
    if (terminalManager?.destroyAll) {
      try { await terminalManager.destroyAll(); } catch {}
    }
    if (server) await new Promise((r) => server.close(r));
    clearSessions();
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  });

  const auth = () => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  });

  async function seedProject(slug, name) {
    await mkdir(projectsDir, { recursive: true });
    const cfg = { name, slug, path: projectDir, createdAt: '2026-05-15T00:00:00.000Z' };
    await writeFile(join(projectsDir, `${slug}.json`), JSON.stringify(cfg, null, 2) + '\n');
  }

  it('changing name updates slug, moves config file, and moves layout dir', async () => {
    await seedProject('old-name', 'Old Name');

    // Seed a layout
    const layout = {
      ...defaultLayout(),
      terminals: [{ id: 't1', cwd: '/tmp', command: 'bash', claudeSessionId: null, background: false }],
    };
    await fetch(`http://localhost:${TEST_PORT}/api/projects/old-name/layout`, {
      method: 'PUT',
      headers: auth(),
      body: JSON.stringify(layout),
    });
    expect(existsSync(join(layoutsDir, 'old-name', 'layout.json'))).toBe(true);

    // Rename via PATCH
    const res = await fetch(`http://localhost:${TEST_PORT}/api/projects/old-name`, {
      method: 'PATCH',
      headers: auth(),
      body: JSON.stringify({ name: 'Brand New Name' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.slug).toBe('brand-new-name');
    expect(body.name).toBe('Brand New Name');

    // Project config moved
    expect(existsSync(join(projectsDir, 'old-name.json'))).toBe(false);
    expect(existsSync(join(projectsDir, 'brand-new-name.json'))).toBe(true);

    // Layout dir moved
    expect(existsSync(join(layoutsDir, 'old-name'))).toBe(false);
    expect(existsSync(join(layoutsDir, 'brand-new-name', 'layout.json'))).toBe(true);

    // Layout content preserved
    const restored = JSON.parse(await readFile(join(layoutsDir, 'brand-new-name', 'layout.json'), 'utf-8'));
    expect(restored.terminals[0].id).toBe('t1');
  });

  it('rename succeeds even when no layout dir exists yet', async () => {
    await seedProject('no-layout', 'No Layout');

    const res = await fetch(`http://localhost:${TEST_PORT}/api/projects/no-layout`, {
      method: 'PATCH',
      headers: auth(),
      body: JSON.stringify({ name: 'Has Name' }),
    });
    expect(res.status).toBe(200);
    expect(existsSync(join(projectsDir, 'has-name.json'))).toBe(true);
    expect(existsSync(join(projectsDir, 'no-layout.json'))).toBe(false);
  });

  it('rename returns 409 if target slug already exists', async () => {
    await seedProject('keep-this', 'Keep This');
    await seedProject('conflict-source', 'Conflict Source');

    const res = await fetch(`http://localhost:${TEST_PORT}/api/projects/conflict-source`, {
      method: 'PATCH',
      headers: auth(),
      body: JSON.stringify({ name: 'Keep This' }),
    });
    expect(res.status).toBe(409);
    // Both projects must still exist
    expect(existsSync(join(projectsDir, 'keep-this.json'))).toBe(true);
    expect(existsSync(join(projectsDir, 'conflict-source.json'))).toBe(true);
  });

  it('rename to the same name is a no-op (200, same slug)', async () => {
    await seedProject('idempotent', 'Idempotent');
    const res = await fetch(`http://localhost:${TEST_PORT}/api/projects/idempotent`, {
      method: 'PATCH',
      headers: auth(),
      body: JSON.stringify({ name: 'Idempotent' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.slug).toBe('idempotent');
  });

  it('non-rename PATCH (layout only) does not move directories', async () => {
    await seedProject('stay-put', 'Stay Put');
    const res = await fetch(`http://localhost:${TEST_PORT}/api/projects/stay-put`, {
      method: 'PATCH',
      headers: auth(),
      body: JSON.stringify({ layout: { mode: 'split' } }),
    });
    expect(res.status).toBe(200);
    expect(existsSync(join(projectsDir, 'stay-put.json'))).toBe(true);
  });

  it('rename returns 400 if new name does not slugify', async () => {
    await seedProject('valid-source', 'Valid Source');
    const res = await fetch(`http://localhost:${TEST_PORT}/api/projects/valid-source`, {
      method: 'PATCH',
      headers: auth(),
      body: JSON.stringify({ name: '!!!' }),
    });
    expect(res.status).toBe(400);
  });
});
