import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { app, httpServer, startServer } from '../src/index.js';

const TEST_PORT = 3099;

describe('DanCode server', () => {
  let server;
  let tempDir;
  let tokenPath;
  let storedToken;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'dancode-server-test-'));
    tokenPath = join(tempDir, 'auth-token');
  });

  afterAll(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('starts and listens on the specified port', async () => {
    server = await startServer(TEST_PORT, { tokenPath });
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
});
