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

/**
 * Wait until a UNIX-socket path is connectable (i.e. shellhost has bound).
 */
async function waitForSocket(socketPath, timeoutMs = 10_000) {
  const { connect } = await import('node:net');
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ok = await new Promise((resolve) => {
      const sock = connect(socketPath);
      const cleanup = () => { try { sock.destroy(); } catch { /* ignore */ } };
      const timer = setTimeout(() => { cleanup(); resolve(false); }, 200);
      sock.once('connect', () => { clearTimeout(timer); cleanup(); resolve(true); });
      sock.once('error', () => { clearTimeout(timer); cleanup(); resolve(false); });
    });
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

async function spawnShellhost({ socketPath, terminalsDir, pidFile }) {
  const child = spawnChild(process.execPath, [SHELLHOST_ENTRY], {
    env: {
      ...process.env,
      DANCODE_SHELLHOST_SOCKET: socketPath,
      DANCODE_TERMINALS_DIR: terminalsDir,
      DANCODE_SHELLHOST_PIDFILE: pidFile,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('shellhost did not start within 10s')),
      10_000,
    );
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

describe('Phase 5: respawn after SIGKILL', () => {
  it('SIGKILL → fresh shellhost → respawn yields new PID, preserved scrollback + cwd, banner emitted', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'phase5-'));
    const socketPath = join(tempDir, 'shellhost.sock');
    const pidFile = join(tempDir, 'shellhost.pid');
    const terminalsDir = join(tempDir, 'terminals');

    let child1 = null;
    let child2 = null;

    try {
      // ── 1. Boot the first shellhost and spawn a real bash PTY ──
      child1 = await spawnShellhost({ socketPath, terminalsDir, pidFile });
      const initialPid = parseInt(
        (await readFile(pidFile, 'utf8')).trim(),
        10,
      );
      expect(initialPid).toBe(child1.pid);

      let client = createShellhostClient({ socketPath });
      await client.connect();

      const SENTINEL = '__PHASE5_STEPA__';
      const CWD = tempDir; // use a real, existing directory

      const sp = await client.spawn({
        projectSlug: 'phase5',
        cwd: CWD,
        // bash login shell so cwd survives and pwd works.
        command: null,
      });
      const terminalId = sp.terminalId;

      // Attach and wait for a sentinel to ensure the PTY is responsive.
      const seen = [];
      client.on('output', (tid, payload) => {
        if (tid === terminalId) seen.push(payload.data);
      });
      await client.attach(terminalId);
      await client.write(terminalId, `echo ${SENTINEL}\n`);
      await waitFor(() => seen.join('').includes(SENTINEL), 8_000, 'sentinel from first shell');

      const firstInspect = await client.inspect(terminalId);
      const firstPid = firstInspect.terminal.pid;
      expect(firstPid).toBeGreaterThan(0);

      // Verify scrollback contains the sentinel on disk.
      const scrollbackPath = join(terminalsDir, terminalId, 'scrollback.log');
      const scrollbackBefore = await readFile(scrollbackPath, 'utf8');
      expect(scrollbackBefore).toContain(SENTINEL);

      // ── 2. SIGKILL the shellhost ──
      client.close();
      child1.kill('SIGKILL');
      await new Promise((r) => child1.once('exit', r));
      // Wait briefly for the socket file to be cleared by the kernel.
      await new Promise((r) => setTimeout(r, 200));
      // The socket file may linger after SIGKILL; clean it so the new
      // shellhost can bind to the same path.
      try {
        const { unlinkSync, existsSync: ex } = await import('node:fs');
        if (ex(socketPath)) unlinkSync(socketPath);
      } catch { /* ignore */ }

      // ── 3. Boot a fresh shellhost on the same socket ──
      child2 = await spawnShellhost({ socketPath, terminalsDir, pidFile });
      const newPid = parseInt((await readFile(pidFile, 'utf8')).trim(), 10);
      expect(newPid).toBe(child2.pid);
      expect(newPid).not.toBe(initialPid);

      client = createShellhostClient({ socketPath });
      await client.connect();

      // ── 4. List shows the terminal as needsRespawn ──
      const beforeList = await client.list();
      const beforeEntry = beforeList.terminals.find((t) => t.id === terminalId);
      expect(beforeEntry).toBeDefined();
      expect(beforeEntry.needsRespawn).toBe(true);
      expect(beforeEntry.pid).toBeNull();

      // ── 5. Attach + respawn; collect output ──
      const seen2 = [];
      client.on('output', (tid, payload) => {
        if (tid === terminalId) seen2.push(payload.data);
      });
      await client.attach(terminalId);
      // Attach replays the prior scrollback (including the sentinel).
      await new Promise((r) => setTimeout(r, 100));

      const respawn = await client.respawn(terminalId);
      expect(respawn.terminal.needsRespawn).toBe(false);
      expect(respawn.terminal.pid).toBeGreaterThan(0);
      expect(respawn.terminal.pid).not.toBe(firstPid);

      // ── 6. Banner emitted to the attached client ──
      await waitFor(
        () => seen2.join('').includes('--- prior session ended at'),
        5_000,
        'banner output',
      );
      const joined = seen2.join('');
      expect(joined).toContain('--- prior session ended at');
      expect(joined).toContain(SENTINEL); // scrollback replay still includes sentinel

      // ── 7. New shell's cwd matches the saved cwd ──
      // Build the sentinel via shell concatenation so the echoed input line
      // doesn't match (substring detection would otherwise fire on the echo
      // before pwd has actually run).
      const seen2BeforeLen = seen2.join('').length;
      await client.write(
        terminalId,
        `S=__PHASE5; S="${'$'}{S}_PWD__"; pwd; echo "${'$'}S"\n`,
      );
      await waitFor(
        () => {
          const tail = seen2.join('').slice(seen2BeforeLen);
          return tail.includes('__PHASE5_PWD__');
        },
        5_000,
        'pwd-done sentinel',
      );
      const post = seen2.join('').slice(seen2BeforeLen);
      expect(post).toContain(tempDir);

      // ── 8. Scrollback on disk still contains step-A (preserved across respawns) ──
      const scrollbackAfter = await readFile(scrollbackPath, 'utf8');
      expect(scrollbackAfter).toContain(SENTINEL);
      // And the banner is on disk too.
      expect(scrollbackAfter).toContain('--- prior session ended at');

      client.close();
    } finally {
      try { child1?.kill('SIGKILL'); } catch { /* ignore */ }
      try { child2?.kill('SIGTERM'); } catch { /* ignore */ }
      if (child2) await new Promise((r) => child2.once('exit', r));
      await rm(tempDir, { recursive: true, force: true });
    }
  }, 30_000);
});

async function waitFor(predicate, timeoutMs, label) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`waitFor(${label}) timed out after ${timeoutMs}ms`);
}
