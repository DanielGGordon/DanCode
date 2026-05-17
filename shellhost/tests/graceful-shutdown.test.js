import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { createShellhostClient } from '../src/client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHELLHOST_ENTRY = join(__dirname, '..', 'src', 'index.js');

/**
 * Phase 10: a graceful shutdown (SIGTERM via `systemctl --user stop`) must
 * NOT delete persisted terminal state. Phase 5 already covered the SIGKILL
 * path; this test covers the SIGTERM path that systemd actually uses.
 *
 * Before this fix, `host.close()` called `manager.killAll()` which removes
 * each terminal's `<baseDir>/<id>/` directory — destroying meta + scrollback
 * needed for Phase 5 respawn.
 */
describe('graceful shutdown preserves terminal state', () => {
  let tempDir;
  let socketPath;
  let child;

  async function spawnShellhost(env = {}) {
    return new Promise((resolve, reject) => {
      const proc = spawn(process.execPath, [SHELLHOST_ENTRY], {
        env: {
          ...process.env,
          DANCODE_SHELLHOST_SOCKET: socketPath,
          DANCODE_TERMINALS_DIR: join(tempDir, 'terminals'),
          DANCODE_SHELLHOST_PIDFILE: join(tempDir, 'shellhost.pid'),
          DANCODE_CLAUDE_INTERVAL_MS: '0',
          ...env,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let resolved = false;
      const onStdout = (b) => {
        if (b.toString('utf8').includes('listening on')) {
          if (!resolved) { resolved = true; proc.stdout.off('data', onStdout); resolve(proc); }
        }
      };
      proc.stdout.on('data', onStdout);
      proc.stderr.on('data', () => { /* noisy but ignore */ });
      proc.once('exit', (code, sig) => {
        if (!resolved) reject(new Error(`shellhost exited prematurely (code=${code} signal=${sig})`));
      });
      setTimeout(() => {
        if (!resolved) reject(new Error('shellhost did not log "listening on" within 10s'));
      }, 10_000);
    });
  }

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'graceful-shutdown-'));
    socketPath = join(tempDir, 'shellhost.sock');
  });

  afterEach(async () => {
    try { child?.kill('SIGKILL'); } catch { /* ignore */ }
    await rm(tempDir, { recursive: true, force: true });
  });

  it('SIGTERM keeps <baseDir>/<id>/meta.json on disk for orphan recovery', async () => {
    child = await spawnShellhost();
    const client = createShellhostClient({ socketPath });
    client.on('error', () => {});
    await client.connect();
    const { terminalId } = await client.spawn({
      projectSlug: 'test', cwd: tempDir, command: 'bash',
    });
    await client.attach(terminalId);
    // Let the spawn fully persist before we kill.
    await new Promise((r) => setTimeout(r, 200));
    client.close();

    const metaPath = join(tempDir, 'terminals', terminalId, 'meta.json');
    expect(existsSync(metaPath)).toBe(true);

    // Graceful shutdown (the same signal `systemctl --user stop` sends).
    const exitPromise = new Promise((r) => child.once('exit', r));
    child.kill('SIGTERM');
    await exitPromise;

    // After a graceful shutdown, the meta MUST still be there. Phase 5
    // respawn depends on it.
    expect(existsSync(metaPath), 'meta.json must survive SIGTERM').toBe(true);
    const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
    expect(meta.id).toBe(terminalId);

    // Restart shellhost; it must load the orphan and report it via list().
    child = await spawnShellhost();
    const client2 = createShellhostClient({ socketPath });
    client2.on('error', () => {});
    await client2.connect();
    const listResult = await client2.list();
    const found = (listResult.terminals || []).find((t) => t.id === terminalId);
    expect(found, 'terminal must be loaded as orphan after SIGTERM/restart').toBeTruthy();
    expect(found.needsRespawn).toBe(true);
    client2.close();
  }, 30_000);
});
