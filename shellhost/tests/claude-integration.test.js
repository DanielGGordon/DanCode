import { describe, it, expect } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn as spawnChild } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createShellhostClient } from '../src/client.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const SHELLHOST_ENTRY = join(__dirname, '..', 'src', 'index.js');
const FAKE_CLAUDE = join(__dirname, 'fixtures', 'fake-claude.mjs');

async function waitFor(predicate, timeoutMs, label) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`waitFor(${label}) timed out after ${timeoutMs}ms`);
}

async function spawnShellhost({ socketPath, terminalsDir, pidFile, claudeHome, intervalMs = 200, extraEnv = {} }) {
  const child = spawnChild(process.execPath, [SHELLHOST_ENTRY], {
    env: {
      ...process.env,
      DANCODE_SHELLHOST_SOCKET: socketPath,
      DANCODE_TERMINALS_DIR: terminalsDir,
      DANCODE_SHELLHOST_PIDFILE: pidFile,
      DANCODE_CLAUDE_HOME: claudeHome,
      DANCODE_CLAUDE_INTERVAL_MS: String(intervalMs),
      ...extraEnv,
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

/**
 * Read /proc/<pid>/cmdline (NUL-separated argv) and return it as an array
 * of strings.
 */
function procCmdline(pid) {
  try {
    const raw = readFileSync(`/proc/${pid}/cmdline`, 'utf8');
    return raw.split('\x00').filter((x) => x.length > 0);
  } catch { return null; }
}

describe('Phase 7: full Claude resume integration', () => {
  it('fake-claude PTY → claudeSessionId populated within 10s → restart shellhost → respawn cmdline is `… claude --resume <id>`', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'phase7-int-'));
    const socketPath = join(tempDir, 'shellhost.sock');
    const pidFile = join(tempDir, 'shellhost.pid');
    const terminalsDir = join(tempDir, 'terminals');
    const claudeHome = join(tempDir, 'claude-home');
    const slug = 'test-slug';
    const sessionId = `00000000-1111-2222-3333-444444444444`;

    let child1 = null;
    let child2 = null;

    // Pass fake-claude env via the shellhost process env (inherited by the
    // PTY's env) so meta.command can be the bare `claude` token.
    const extraEnv = {
      FAKE_CLAUDE_SLUG: slug,
      FAKE_CLAUDE_SESSION: sessionId,
      CLAUDE_HOME: claudeHome,
    };

    try {
      // ── 1. Boot shellhost with the detector pointing at a temp claude home ──
      child1 = await spawnShellhost({
        socketPath, terminalsDir, pidFile, claudeHome,
        intervalMs: 200, extraEnv,
      });

      let client = createShellhostClient({ socketPath });
      await client.connect();

      // ── 2. Spawn a PTY whose meta.command starts with `claude`. We use a
      //    symlink at `${tempDir}/claude` → fake-claude.mjs so the basename
      //    of the head token is exactly "claude" (what isClaudeCommand
      //    checks), while the actual node process runs fake-claude.
      //
      //    We embed the env inline so the wrapper picks it up: meta.command
      //    starts with `claude` because the head token is the absolute
      //    symlink path whose basename === "claude". After respawn, the
      //    rewritten command (`claude --resume <id>`) doesn't have to
      //    actually find `claude` on PATH because we're verifying via
      //    /proc/<pid>/cmdline before the child fails.
      const { symlinkSync } = await import('node:fs');
      const claudePath = join(tempDir, 'claude');
      // Symlink `claude` → fake-claude.mjs. node-pty's exec resolution will
      // see the leading shebang and interpret it (the fixture has #!/usr/bin/env node).
      symlinkSync(FAKE_CLAUDE, claudePath);

      const spawnRes = await client.spawn({
        projectSlug: slug,
        cwd: tempDir,
        command: claudePath,
      });
      const terminalId = spawnRes.terminalId;
      await client.attach(terminalId);

      // ── Initial command starts with absolute path; isClaudeCommand
      //    checks the basename of the head token. Verify that:
      const inspect0 = await client.inspect(terminalId);
      expect(inspect0.terminal.command).toContain(claudePath);

      const seen = [];
      client.on(`output:${terminalId}`, (payload) => seen.push(payload.data));
      await waitFor(
        () => seen.join('').includes('fake-claude started'),
        10_000,
        'fake-claude startup',
      );

      // ── 3. Within 10s, meta.claudeSessionId becomes the fake session id ──
      const metaPath = join(terminalsDir, terminalId, 'meta.json');
      await waitFor(
        async () => {
          if (!existsSync(metaPath)) return false;
          try {
            const meta = JSON.parse(await readFile(metaPath, 'utf8'));
            return meta.claudeSessionId === sessionId;
          } catch { return false; }
        },
        10_000,
        'claudeSessionId populated',
      );

      const inspected = await client.inspect(terminalId);
      expect(inspected.terminal.claudeSessionId).toBe(sessionId);

      // ── 4. SIGKILL the shellhost ──
      client.close();
      child1.kill('SIGKILL');
      await new Promise((r) => child1.once('exit', r));
      await new Promise((r) => setTimeout(r, 200));
      try {
        const { unlinkSync, existsSync: ex } = await import('node:fs');
        if (ex(socketPath)) unlinkSync(socketPath);
      } catch { /* ignore */ }

      // ── 5. Restart shellhost on the same socket ──
      child2 = await spawnShellhost({
        socketPath, terminalsDir, pidFile, claudeHome,
        intervalMs: 200, extraEnv,
      });
      client = createShellhostClient({ socketPath });
      await client.connect();

      // Recovered as needsRespawn with the persisted session id.
      const list = await client.list();
      const entry = list.terminals.find((t) => t.id === terminalId);
      expect(entry).toBeDefined();
      expect(entry.needsRespawn).toBe(true);
      expect(entry.claudeSessionId).toBe(sessionId);

      // ── 6. Respawn: the PTY's argv should be `bash -lc 'claude --resume <id>'`.
      //    We verify directly via /proc/<pid>/cmdline (Linux).
      await client.attach(terminalId);
      const respawn = await client.respawn(terminalId);
      const respawnPid = respawn.terminal.pid;
      expect(respawnPid).toBeGreaterThan(0);

      // Read cmdline immediately — bash should still be alive even if it
      // exits with "command not found" because of nohup-like behaviour.
      // Try a few times in case of timing.
      let cmdline = null;
      await waitFor(
        () => {
          cmdline = procCmdline(respawnPid);
          return cmdline !== null;
        },
        5_000,
        'respawn cmdline',
      );
      expect(cmdline).not.toBeNull();
      // bash login shell + `-lc` + the inlined Claude resume command.
      const joined = cmdline.join(' ');
      expect(joined).toContain('-lc');
      expect(joined).toContain('claude --resume');
      expect(joined).toContain(sessionId);

      // Also verify meta.command was preserved (NOT overwritten with the
      // resume form) so future detection still recognises this terminal.
      const meta = JSON.parse(await readFile(metaPath, 'utf8'));
      expect(meta.command).toContain(claudePath);
      expect(meta.claudeSessionId).toBe(sessionId);

      client.close();
    } finally {
      try { child1?.kill('SIGKILL'); } catch { /* ignore */ }
      try { child2?.kill('SIGTERM'); } catch { /* ignore */ }
      if (child2) await new Promise((r) => child2.once('exit', r));
      await rm(tempDir, { recursive: true, force: true });
    }
  }, 30_000);
});
