/**
 * Phase 8 integration test: real systemd-user scope survives shellhost SIGKILL.
 *
 * Spawns a real dancode-shellhost subprocess on a temp UNIX socket, then:
 *   1. Creates a background-mode terminal whose command writes a marker
 *      file after a short sleep.
 *   2. SIGKILLs the shellhost process (no cleanup path runs).
 *   3. Waits for the marker file to appear.
 *
 * Skipped automatically if `systemd-run` or `systemctl --user` are not
 * available on this machine.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { mkdtemp, rm, stat, readFile } from 'node:fs/promises';
import { unlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { backgroundUnitName } from '../src/pty-manager.js';
import { createShellhostClient } from '../src/client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHELLHOST_BIN = join(__dirname, '..', 'bin', 'dancode-shellhost.js');

function systemdRunAvailable() {
  try {
    // `is-system-running` returns non-zero on "degraded" — which is fine for
    // our purposes. We just need a working user manager, so probe with
    // `--user list-units` which exits 0 iff the user systemd is up.
    const probe = spawnSync(
      'systemctl',
      ['--user', 'list-units', '--no-legend'],
      { stdio: 'ignore' }
    );
    if (probe.error || probe.status !== 0) return false;
    const runProbe = spawnSync('systemd-run', ['--version'], { stdio: 'ignore' });
    return !runProbe.error && runProbe.status === 0;
  } catch {
    return false;
  }
}

const HAS_SYSTEMD = systemdRunAvailable();
const describeFn = HAS_SYSTEMD ? describe : describe.skip;

async function waitForSocket(socketPath, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (existsSync(socketPath)) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}

function spawnShellhost(socketPath, baseDir) {
  const child = spawn(process.execPath, [SHELLHOST_BIN], {
    stdio: 'pipe',
    env: {
      ...process.env,
      DANCODE_SHELLHOST_SOCKET: socketPath,
      DANCODE_TERMINALS_DIR: baseDir,
      DANCODE_SHELLHOST_PIDFILE: join(baseDir, 'shellhost.pid'),
    },
    detached: false,
  });
  // Forward stderr for debugging if a test fails.
  child.stderr.on('data', (d) => process.stderr.write(`[shellhost-sub] ${d}`));
  return child;
}

describeFn('background-mode integration (real shellhost subprocess + systemd-user)', () => {
  let tempDir;
  let socketPath;
  let child;
  let markers;
  let createdUnits;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'bg-int-'));
    socketPath = join(tempDir, 'shellhost.sock');
    markers = [];
    createdUnits = [];
    child = spawnShellhost(socketPath, join(tempDir, 'sb'));
    const ready = await waitForSocket(socketPath, 8000);
    if (!ready) {
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
      throw new Error('shellhost subprocess did not create socket in time');
    }
  });

  afterEach(async () => {
    if (child && !child.killed) {
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
      // Wait briefly for exit so the next test starts clean.
      await new Promise((resolve) => {
        const t = setTimeout(resolve, 500);
        child.once('exit', () => { clearTimeout(t); resolve(); });
      });
    }
    for (const unit of createdUnits) {
      try {
        execFileSync('systemctl', ['--user', 'stop', unit], { stdio: 'ignore' });
      } catch { /* unit may already be gone */ }
    }
    for (const m of markers) {
      try { unlinkSync(m); } catch { /* may not exist */ }
    }
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  });

  it('background command survives shellhost SIGKILL and completes', async () => {
    const marker = join(tempDir, `bg-marker-${randomUUID().slice(0, 8)}.txt`);
    markers.push(marker);

    const client = createShellhostClient({ socketPath });
    await client.connect();

    // Sleep long enough to span the SIGKILL gap, short enough to keep test
    // fast on slow hardware (the Pi takes ~1s to register a scope).
    const sleepSecs = 6;
    const { terminalId } = await client.spawn({
      projectSlug: 'bg-int',
      cwd: tempDir,
      command: `sleep ${sleepSecs} && echo done > ${marker}`,
      background: true,
    });
    expect(terminalId).toMatch(/^[a-f0-9-]{36}$/);
    const unitName = `${backgroundUnitName(terminalId)}.scope`;
    createdUnits.push(unitName);

    // Give systemd a moment to register the scope.
    await new Promise((r) => setTimeout(r, 800));

    // Verify the scope is registered before we kill shellhost.
    const probeBefore = spawnSync(
      'systemctl',
      ['--user', 'is-active', unitName],
      { encoding: 'utf8' }
    );
    expect(probeBefore.stdout.trim()).toBe('active');

    client.close();

    // SIGKILL the shellhost subprocess. The cleanup path does NOT run; the
    // OS just tears the process down. The systemd scope must outlive it.
    child.kill('SIGKILL');
    await new Promise((resolve) => {
      const t = setTimeout(resolve, 2000);
      child.once('exit', () => { clearTimeout(t); resolve(); });
    });

    // Wait up to sleepSecs + 4 seconds for the marker.
    const deadline = Date.now() + (sleepSecs + 4) * 1000;
    let exists = false;
    while (Date.now() < deadline) {
      try {
        await stat(marker);
        exists = true;
        break;
      } catch { /* not yet */ }
      await new Promise((r) => setTimeout(r, 200));
    }
    expect(exists).toBe(true);
    const contents = await readFile(marker, 'utf8');
    expect(contents.trim()).toBe('done');
  }, 30_000);

  it('killing a background terminal stops the systemd scope', async () => {
    const client = createShellhostClient({ socketPath });
    await client.connect();
    const { terminalId } = await client.spawn({
      projectSlug: 'kill-int',
      cwd: tempDir,
      command: 'sleep 60',
      background: true,
    });
    const unitName = `${backgroundUnitName(terminalId)}.scope`;
    createdUnits.push(unitName);
    await new Promise((r) => setTimeout(r, 800));

    const before = spawnSync(
      'systemctl',
      ['--user', 'is-active', unitName],
      { encoding: 'utf8' }
    );
    expect(before.stdout.trim()).toBe('active');

    await client.kill(terminalId);
    client.close();
    await new Promise((r) => setTimeout(r, 1000));

    const after = spawnSync(
      'systemctl',
      ['--user', 'is-active', unitName],
      { encoding: 'utf8' }
    );
    expect(['inactive', 'failed', '']).toContain(after.stdout.trim());
  }, 20_000);
});
