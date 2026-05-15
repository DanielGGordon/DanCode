import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn as spawnChild } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createShellhost } from '../src/server.js';
import { createShellhostClient } from '../src/client.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

/**
 * Boots a real shellhost (in-process for speed) against a temp socket
 * and exercises it via the real wire protocol via a client connection.
 * If the test runner can't load node-pty (no build deps), tests are
 * skipped at runtime — see beforeEach.
 */

describe('shellhost integration', () => {
  let tempDir;
  let socketPath;
  let host;
  let client;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'shellhost-int-'));
    socketPath = join(tempDir, 'shellhost.sock');
    host = createShellhost();
    await host.listen(socketPath);
    client = createShellhostClient({ socketPath });
    await client.connect();
  });

  afterEach(async () => {
    try { client?.close(); } catch { /* ignore */ }
    try { await host?.close(); } catch { /* ignore */ }
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  });

  it('spawns a PTY that runs `echo hi` and emits hi\\n then exits 0', async () => {
    // Collect output for the terminal we are about to spawn.
    const output = [];
    let exitInfo = null;
    const exitPromise = new Promise((resolve) => {
      client.on('output', (terminalId, payload) => {
        output.push(payload.data);
      });
      client.on('exit', (terminalId, payload) => {
        exitInfo = payload;
        resolve();
      });
    });

    const { terminalId } = await client.spawn({
      projectSlug: 'echo-test',
      command: "bash -lc 'echo hi'",
    });
    await client.attach(terminalId);

    // Wait for exit (with timeout)
    await Promise.race([
      exitPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout waiting for exit')), 10000)),
    ]);

    expect(exitInfo).not.toBeNull();
    expect(exitInfo.exitCode).toBe(0);
    expect(output.join('')).toMatch(/hi\r?\n/);
  });

  it('list returns spawned terminals; kill removes them', async () => {
    const a = await client.spawn({ projectSlug: 'p', command: 'sleep 30' });
    const b = await client.spawn({ projectSlug: 'p', command: 'sleep 30' });

    const list1 = await client.list();
    const ids1 = list1.terminals.map((t) => t.id).sort();
    expect(ids1).toContain(a.terminalId);
    expect(ids1).toContain(b.terminalId);

    await client.kill(a.terminalId);
    const list2 = await client.list();
    const ids2 = list2.terminals.map((t) => t.id);
    expect(ids2).not.toContain(a.terminalId);
    expect(ids2).toContain(b.terminalId);

    await client.kill(b.terminalId);
  });

  it('disconnecting the client does not kill the PTY', async () => {
    const { terminalId } = await client.spawn({ projectSlug: 'p', command: 'sleep 30' });
    // Close client → server connection.
    client.close();
    // Wait long enough for any close-side effects to run.
    await new Promise((r) => setTimeout(r, 100));
    // Open a fresh connection and verify the PTY is still alive.
    const c2 = createShellhostClient({ socketPath });
    await c2.connect();
    const list = await c2.list();
    expect(list.terminals.map((t) => t.id)).toContain(terminalId);
    await c2.kill(terminalId);
    c2.close();
  });

  it('write + read round-trips through a real bash PTY', async () => {
    const collected = [];
    const sawSentinelP = new Promise((resolve) => {
      const onData = (terminalId, payload) => {
        collected.push(payload.data);
        if (collected.join('').includes('__SENTINEL__')) {
          client.off('output', onData);
          resolve();
        }
      };
      client.on('output', onData);
    });

    const { terminalId } = await client.spawn({ projectSlug: 'rt' });
    await client.attach(terminalId);
    await client.write(terminalId, "printf '__SENTINEL__\\n'\n");

    await Promise.race([
      sawSentinelP,
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 8000)),
    ]);
    expect(collected.join('')).toContain('__SENTINEL__');
    await client.kill(terminalId);
  });
});

describe('shellhost as a child process', () => {
  it('boots from CLI on a temp socket and answers a list op', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'shellhost-cli-'));
    const socketPath = join(tempDir, 'shellhost.sock');
    const entry = join(__dirname, '..', 'src', 'index.js');

    const child = spawnChild(process.execPath, [entry], {
      env: { ...process.env, DANCODE_SHELLHOST_SOCKET: socketPath },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stderr = [];
    child.stderr.on('data', (b) => stderr.push(b.toString('utf8')));

    // Wait until the socket is listening.
    const ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('shellhost did not start')), 5000);
      child.stdout.on('data', (chunk) => {
        if (chunk.toString('utf8').includes('listening on')) {
          clearTimeout(timer);
          resolve();
        }
      });
      child.once('exit', (code) => {
        if (code !== 0) reject(new Error(`shellhost exited with ${code}: ${stderr.join('')}`));
      });
    });

    try {
      await ready;
      const client = createShellhostClient({ socketPath });
      await client.connect();
      const result = await client.list();
      expect(Array.isArray(result.terminals)).toBe(true);
      client.close();
    } finally {
      child.kill('SIGTERM');
      await new Promise((r) => child.once('exit', r));
      await rm(tempDir, { recursive: true, force: true });
    }
  }, 15000);
});
