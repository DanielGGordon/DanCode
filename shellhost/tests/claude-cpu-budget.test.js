import { describe, it, expect } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn as spawnChild } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createShellhostClient } from '../src/client.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const SHELLHOST_ENTRY = join(__dirname, '..', 'src', 'index.js');

const CLK_TCK = 100; // standard on Linux; matches sysconf(_SC_CLK_TCK)

function readProcCpu(pid) {
  // /proc/<pid>/stat: pid (comm) state ... utime stime cutime cstime ...
  // utime is the 14th field; stime is the 15th. We need to handle the
  // possibility that (comm) contains spaces.
  const raw = readFileSync(`/proc/${pid}/stat`, 'utf8');
  const closeParen = raw.lastIndexOf(')');
  const rest = raw.slice(closeParen + 2).split(' ');
  // After (comm), field 3 is state. utime is field 14 overall, so within
  // `rest` (which starts at field 3) it's index 11. stime is index 12.
  const utime = parseInt(rest[11], 10);
  const stime = parseInt(rest[12], 10);
  return { utime, stime, total: utime + stime };
}

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

describe('Phase 7 CPU budget', () => {
  it('inspection loop CPU < 600ms cumulative over 60s with 5 Claude-detection terminals (=< 1% sustained)', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'phase7-cpu-'));
    const socketPath = join(tempDir, 'shellhost.sock');
    const pidFile = join(tempDir, 'shellhost.pid');
    const terminalsDir = join(tempDir, 'terminals');
    const claudeHome = join(tempDir, 'claude-home');
    let child = null;

    try {
      child = await spawnShellhost({
        socketPath, terminalsDir, pidFile, claudeHome,
        intervalMs: 5000, // 5s interval — the production setting
      });
      const shellPid = child.pid;
      const client = createShellhostClient({ socketPath });
      await client.connect();

      // Spawn 5 idle PTYs (sleep) so the detector has ttys to inspect.
      const ids = [];
      for (let i = 0; i < 5; i++) {
        const r = await client.spawn({
          projectSlug: 'cpu-test',
          cwd: tempDir,
          command: 'sleep 600',
        });
        ids.push(r.terminalId);
      }
      // Let the detector run a few ticks to warm up.
      await new Promise((r) => setTimeout(r, 500));

      const before = readProcCpu(shellPid);
      const t0 = Date.now();
      // Sleep 60s; meanwhile the detector runs 12 ticks (5s × 12 = 60s).
      await new Promise((r) => setTimeout(r, 60_000));
      const elapsed = Date.now() - t0;
      const after = readProcCpu(shellPid);

      const ticks = after.total - before.total;
      const ms = (ticks / CLK_TCK) * 1000;
      // Log for visibility — vitest only prints on failure but it's useful.
      // eslint-disable-next-line no-console
      console.log(`[phase7-cpu] shellhost CPU = ${ticks} jiffies = ${ms.toFixed(1)}ms over ${elapsed}ms`);

      // Budget: 600ms (1% of 60s).
      expect(ms).toBeLessThan(600);

      // Tidy up so the test exits promptly.
      for (const id of ids) {
        try { await client.kill(id); } catch { /* ignore */ }
      }
      client.close();
    } finally {
      try { child?.kill('SIGTERM'); } catch { /* ignore */ }
      if (child) await new Promise((r) => child.once('exit', r));
      await rm(tempDir, { recursive: true, force: true });
    }
  }, 120_000);
});
