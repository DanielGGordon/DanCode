import { describe, it, expect } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn as spawnChild } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createShellhostClient } from '../src/client.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const SHELLHOST_ENTRY = join(__dirname, '..', 'src', 'index.js');

async function spawnShellhost({ socketPath, terminalsDir, pidFile, claudeHome, intervalMs }) {
  const child = spawnChild(process.execPath, [SHELLHOST_ENTRY], {
    env: {
      ...process.env,
      DANCODE_SHELLHOST_SOCKET: socketPath,
      DANCODE_TERMINALS_DIR: terminalsDir,
      DANCODE_SHELLHOST_PIDFILE: pidFile,
      DANCODE_CLAUDE_HOME: claudeHome,
      DANCODE_CLAUDE_INTERVAL_MS: String(intervalMs),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('shellhost did not start within 10s')), 10_000);
    const onStdout = (b) => {
      if (b.toString('utf8').includes('listening on')) {
        clearTimeout(timer);
        child.stdout.off('data', onStdout);
        resolve();
      }
    };
    child.stdout.on('data', onStdout);
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`shellhost exited prematurely (code=${code} signal=${signal})`));
    });
  });
  return child;
}

describe('Phase 7 false-positive', () => {
  it('5 idle bash PTYs over the equivalent of 5 min of inspection (accelerated): no terminal is flagged Claude-active', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'phase7-fp-'));
    const socketPath = join(tempDir, 'shellhost.sock');
    const pidFile = join(tempDir, 'shellhost.pid');
    const terminalsDir = join(tempDir, 'terminals');
    const claudeHome = join(tempDir, 'claude-home');
    let child = null;

    try {
      // Accelerated: 50ms interval × 6000ms = 120 ticks. With the production
      // 5s interval that's 600 seconds (10 minutes — well past the 5-minute
      // requirement). The property under test is "any bash idle terminal
      // never gets misidentified", not the wall clock.
      child = await spawnShellhost({
        socketPath, terminalsDir, pidFile, claudeHome,
        intervalMs: 50,
      });
      const client = createShellhostClient({ socketPath });
      await client.connect();

      // Spawn 5 idle bash PTYs. No commands typed — they sit at a prompt.
      const ids = [];
      for (let i = 0; i < 5; i++) {
        const r = await client.spawn({
          projectSlug: 'idle-test',
          cwd: tempDir,
          command: null, // bash login shell
        });
        ids.push(r.terminalId);
      }

      // Let the detector tick at least ~100 times (=5s with 50ms interval).
      await new Promise((r) => setTimeout(r, 6_000));

      // Assert no meta.json has a claudeSessionId set.
      for (const id of ids) {
        const metaPath = join(terminalsDir, id, 'meta.json');
        expect(existsSync(metaPath)).toBe(true);
        const meta = JSON.parse(await readFile(metaPath, 'utf8'));
        expect(
          meta.claudeSessionId,
          `terminal ${id} should not be flagged Claude-active; meta=${JSON.stringify(meta)}`,
        ).toBeFalsy();

        // And the inspect op agrees.
        const insp = await client.inspect(id);
        expect(insp.terminal.claudeSessionId).toBeFalsy();
      }

      for (const id of ids) {
        try { await client.kill(id); } catch { /* ignore */ }
      }
      client.close();
    } finally {
      try { child?.kill('SIGTERM'); } catch { /* ignore */ }
      if (child) await new Promise((r) => child.once('exit', r));
      await rm(tempDir, { recursive: true, force: true });
    }
  }, 30_000);
});
