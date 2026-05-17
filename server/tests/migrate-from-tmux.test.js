import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const execFileAsync = promisify(execFile);

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const MIGRATE_SCRIPT = join(REPO_ROOT, 'bin', 'dancode-migrate-from-tmux');

function uniqueSlug(tag) {
  // Slugs sometimes contain hyphens in real usage; include one to exercise
  // the parser's multi-hyphen-slug code path.
  return `mig-${tag}-${process.pid}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

async function tmuxHasSession(name) {
  try {
    await execFileAsync('tmux', ['has-session', '-t', name]);
    return true;
  } catch {
    return false;
  }
}

async function tmuxKill(name) {
  try {
    await execFileAsync('tmux', ['kill-session', '-t', name]);
  } catch {
    // already dead
  }
}

async function tmuxNewDetached(name, { cwd } = {}) {
  const args = ['new-session', '-d', '-s', name, '-x', '120', '-y', '40'];
  if (cwd) args.push('-c', cwd);
  await execFileAsync('tmux', args);
  await execFileAsync('tmux', ['set-option', '-t', name, 'status', 'off']);
}

async function tmuxSendLine(name, text) {
  await execFileAsync('tmux', ['send-keys', '-t', name, text, 'Enter']);
}

async function waitFor(pred, { timeoutMs = 4000, intervalMs = 50 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await pred()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error('waitFor timed out');
}

async function runMigrate(env) {
  return execFileAsync('node', [MIGRATE_SCRIPT], { env: { ...process.env, ...env } });
}

describe('bin/dancode-migrate-from-tmux integration', () => {
  let tempHome;
  let cwd1;
  let cwd2;
  let cwd3;
  const created = []; // list of full session names we created
  const slugA = uniqueSlug('a');
  const slugB = uniqueSlug('b');
  // Real legacy session names embed randomUUID(), which has 4 hyphens of its
  // own; the migration parser uses that shape to peel id off slug correctly.
  const idA1 = randomUUID();
  const idA2 = randomUUID();
  const idB1 = randomUUID();
  const sessionA1 = `dancode-${slugA}-${idA1}`;
  const sessionA2 = `dancode-${slugA}-${idA2}`;
  const sessionB1 = `dancode-${slugB}-${idB1}`;

  beforeEach(async () => {
    tempHome = mkdtempSync(join(tmpdir(), 'dancode-migrate-home-'));
    cwd1 = mkdtempSync(join(tmpdir(), 'dancode-migrate-cwd1-'));
    cwd2 = mkdtempSync(join(tmpdir(), 'dancode-migrate-cwd2-'));
    cwd3 = mkdtempSync(join(tmpdir(), 'dancode-migrate-cwd3-'));

    // Three dancode-* sessions, two for slugA, one for slugB
    await tmuxNewDetached(sessionA1, { cwd: cwd1 });
    created.push(sessionA1);
    await tmuxNewDetached(sessionA2, { cwd: cwd2 });
    created.push(sessionA2);
    await tmuxNewDetached(sessionB1, { cwd: cwd3 });
    created.push(sessionB1);

    // Pre-populate scrollback so capture-pane has content.
    await tmuxSendLine(sessionA1, 'echo PHASE9MARKER_A1');
    await tmuxSendLine(sessionA2, 'echo PHASE9MARKER_A2');
    await tmuxSendLine(sessionB1, 'echo PHASE9MARKER_B1');

    // Give the shells time to actually print the marker.
    await waitFor(async () => {
      const { stdout } = await execFileAsync('tmux', [
        'capture-pane', '-p', '-S', '-', '-t', sessionA1,
      ]);
      return stdout.includes('PHASE9MARKER_A1');
    });
    await waitFor(async () => {
      const { stdout } = await execFileAsync('tmux', [
        'capture-pane', '-p', '-S', '-', '-t', sessionA2,
      ]);
      return stdout.includes('PHASE9MARKER_A2');
    });
    await waitFor(async () => {
      const { stdout } = await execFileAsync('tmux', [
        'capture-pane', '-p', '-S', '-', '-t', sessionB1,
      ]);
      return stdout.includes('PHASE9MARKER_B1');
    });
  });

  afterEach(async () => {
    for (const name of created) {
      await tmuxKill(name);
    }
    created.length = 0;
    rmSync(tempHome, { recursive: true, force: true });
    rmSync(cwd1, { recursive: true, force: true });
    rmSync(cwd2, { recursive: true, force: true });
    rmSync(cwd3, { recursive: true, force: true });
  });

  it('migrates dancode-* sessions: meta.json + scrollback + layout + kills sessions; idempotent on re-run', async () => {
    expect(existsSync(MIGRATE_SCRIPT)).toBe(true);

    const { stdout: out1 } = await runMigrate({ HOME: tempHome });
    expect(out1).toMatch(/Migrated 3 terminals across 2 projects\./);
    expect(out1).toMatch(/Killed 3 tmux sessions\./);

    // meta.json files for the three terminal ids exist with correct fields
    const termsDir = join(tempHome, '.dancode', 'terminals');
    for (const [id, cwd, slug] of [
      [idA1, cwd1, slugA],
      [idA2, cwd2, slugA],
      [idB1, cwd3, slugB],
    ]) {
      const metaPath = join(termsDir, id, 'meta.json');
      expect(existsSync(metaPath)).toBe(true);
      const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
      expect(meta.id).toBe(id);
      expect(meta.projectSlug).toBe(slug);
      expect(meta.cwd).toBe(cwd);
      expect(typeof meta.command).toBe('string');
      expect(meta.command.length).toBeGreaterThan(0);

      const sbPath = join(termsDir, id, 'scrollback.log');
      expect(existsSync(sbPath)).toBe(true);
    }

    // Scrollback files contain the pre-captured pane markers
    expect(readFileSync(join(termsDir, idA1, 'scrollback.log'), 'utf8')).toContain('PHASE9MARKER_A1');
    expect(readFileSync(join(termsDir, idA2, 'scrollback.log'), 'utf8')).toContain('PHASE9MARKER_A2');
    expect(readFileSync(join(termsDir, idB1, 'scrollback.log'), 'utf8')).toContain('PHASE9MARKER_B1');

    // layout.json files mention the new terminal ids
    const layoutA = JSON.parse(readFileSync(join(tempHome, '.dancode', 'projects', slugA, 'layout.json'), 'utf8'));
    const layoutB = JSON.parse(readFileSync(join(tempHome, '.dancode', 'projects', slugB, 'layout.json'), 'utf8'));
    const layoutAIds = layoutA.terminals.map((t) => t.id).sort();
    expect(layoutAIds).toEqual([idA1, idA2].sort());
    expect(layoutB.terminals.map((t) => t.id)).toEqual([idB1]);

    // Killed sessions: tmux has-session must fail.
    expect(await tmuxHasSession(sessionA1)).toBe(false);
    expect(await tmuxHasSession(sessionA2)).toBe(false);
    expect(await tmuxHasSession(sessionB1)).toBe(false);

    // --- Idempotence: re-running the script should produce no new files,
    // not throw, and not double-add terminals to layout.
    const beforeListings = listDir(termsDir);
    const layoutAStat1 = readFileSync(join(tempHome, '.dancode', 'projects', slugA, 'layout.json'), 'utf8');
    const layoutBStat1 = readFileSync(join(tempHome, '.dancode', 'projects', slugB, 'layout.json'), 'utf8');

    const { stdout: out2 } = await runMigrate({ HOME: tempHome });
    // No sessions to migrate the second time, so the counts must reflect that.
    expect(out2).toMatch(/Migrated 0 terminals across 0 projects\./);
    expect(out2).toMatch(/Killed 0 tmux sessions\./);

    const afterListings = listDir(termsDir);
    expect(afterListings).toEqual(beforeListings);
    const layoutAStat2 = readFileSync(join(tempHome, '.dancode', 'projects', slugA, 'layout.json'), 'utf8');
    const layoutBStat2 = readFileSync(join(tempHome, '.dancode', 'projects', slugB, 'layout.json'), 'utf8');
    expect(layoutAStat2).toBe(layoutAStat1);
    expect(layoutBStat2).toBe(layoutBStat1);
  }, 60_000);

  it('reports stale-legacy-files cleanup count in the summary', async () => {
    // Plant a legacy <id>.json metadata file in the terminals dir.
    const termsDir = join(tempHome, '.dancode', 'terminals');
    mkdirSync(termsDir, { recursive: true });
    writeFileSync(
      join(termsDir, 'legacy-fixture.json'),
      JSON.stringify({ id: 'legacy-fixture', tmuxSessionName: 'dancode-old-legacy-fixture' }),
    );

    const { stdout } = await runMigrate({ HOME: tempHome });
    expect(stdout).toMatch(/Removed 1 stale legacy files\./);

    // The legacy file is gone after the run.
    expect(existsSync(join(termsDir, 'legacy-fixture.json'))).toBe(false);
  }, 30_000);
});

function listDir(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    out.push(name);
    let isDir = false;
    try { isDir = statSync(path).isDirectory(); } catch { /* ignore */ }
    if (isDir) {
      for (const child of readdirSync(path)) {
        out.push(`${name}/${child}`);
      }
    }
  }
  return out.sort();
}
