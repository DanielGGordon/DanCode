import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createShellhost } from 'dancode-shellhost/src/server.js';
import { PTYManager } from 'dancode-shellhost/src/pty-manager.js';
import { ScrollbackStore } from 'dancode-shellhost/src/scrollback.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HEALTHCHECK_BIN = join(__dirname, '..', '..', 'bin', 'dancode-healthcheck.mjs');

/**
 * Run the healthcheck binary as a subprocess and capture exit code + stdout/stderr.
 */
function runHealthcheck(env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [HEALTHCHECK_BIN], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (b) => { stdout += b.toString('utf8'); });
    child.stderr.on('data', (b) => { stderr += b.toString('utf8'); });
    child.once('exit', (code) => resolve({ code, stdout, stderr }));
  });
}

describe('dancode-healthcheck', () => {
  let tempDir;
  let socketPath;
  let host;
  let stubServer;
  let stubPort;
  let stubBehavior = { setupStatus: 200 };

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'dancode-healthcheck-'));
    socketPath = join(tempDir, 'shellhost.sock');
    const scrollback = new ScrollbackStore({ baseDir: join(tempDir, 'terminals') });
    const manager = new PTYManager({ scrollback });
    host = createShellhost({ manager });
    await host.listen(socketPath);

    // Minimal stub HTTP server that mimics the dancode-server's
    // /api/auth/setup/status endpoint.
    stubServer = createServer((req, res) => {
      if (req.url === '/api/auth/setup/status') {
        if (stubBehavior.setupStatus === 'hang') {
          // never respond — used to test timeouts
          return;
        }
        res.statusCode = stubBehavior.setupStatus;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ setupComplete: false }));
        return;
      }
      res.statusCode = 404;
      res.end();
    });
    await new Promise((r) => stubServer.listen(0, '127.0.0.1', r));
    stubPort = stubServer.address().port;
  }, 30_000);

  afterAll(async () => {
    try { await host?.close(); } catch { /* ignore */ }
    await new Promise((r) => stubServer?.close(r));
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  });

  it('exits 0 when shellhost socket and server endpoint are both healthy', async () => {
    const { code, stdout } = await runHealthcheck({
      DANCODE_SHELLHOST_SOCKET: socketPath,
      DANCODE_SERVER_URL: `http://127.0.0.1:${stubPort}`,
    });
    expect(code, `stdout was:\n${stdout}`).toBe(0);
    // Should mention each green check.
    expect(stdout).toMatch(/shellhost socket/i);
    expect(stdout).toMatch(/list op/i);
    expect(stdout).toMatch(/echo healthcheck/i);
    expect(stdout).toMatch(/setup\/status/i);
  }, 20_000);

  it('exits non-zero when shellhost socket is missing', async () => {
    const { code, stdout, stderr } = await runHealthcheck({
      DANCODE_SHELLHOST_SOCKET: join(tempDir, 'does-not-exist.sock'),
      DANCODE_SERVER_URL: `http://127.0.0.1:${stubPort}`,
    });
    expect(code).not.toBe(0);
    expect(stdout + stderr).toMatch(/shellhost socket/i);
  }, 15_000);

  it('exits non-zero when server returns 500 on /api/auth/setup/status', async () => {
    const prev = stubBehavior.setupStatus;
    stubBehavior.setupStatus = 500;
    try {
      const { code } = await runHealthcheck({
        DANCODE_SHELLHOST_SOCKET: socketPath,
        DANCODE_SERVER_URL: `http://127.0.0.1:${stubPort}`,
      });
      expect(code).not.toBe(0);
    } finally {
      stubBehavior.setupStatus = prev;
    }
  }, 20_000);
});
