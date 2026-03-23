import { describe, it, expect, afterAll, afterEach, beforeEach } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { sessionExists, createSession, ensureSession, createProjectSession, createConnectionSession, destroyConnectionSession, listSessions, listWindows } from '../src/tmux.js';

const execFileAsync = promisify(execFile);
const TEST_SESSION = 'dancode-tmux-test';

async function killSession(name) {
  try {
    await execFileAsync('tmux', ['kill-session', '-t', name]);
  } catch {
    // session didn't exist — fine
  }
}

describe('tmux session management', () => {
  afterAll(async () => {
    await killSession(TEST_SESSION);
  });

  it('sessionExists returns false for a non-existent session', async () => {
    await killSession(TEST_SESSION);
    expect(await sessionExists(TEST_SESSION)).toBe(false);
  });

  it('createSession creates a new tmux session', async () => {
    await killSession(TEST_SESSION);
    await createSession(TEST_SESSION);
    const exists = await sessionExists(TEST_SESSION);
    expect(exists).toBe(true);
  });

  it('sessionExists returns true for an existing session', async () => {
    // session was created by previous test
    expect(await sessionExists(TEST_SESSION)).toBe(true);
  });

  it('ensureSession does not recreate an existing session', async () => {
    const result = await ensureSession(TEST_SESSION);
    expect(result.created).toBe(false);
    expect(await sessionExists(TEST_SESSION)).toBe(true);
  });

  it('ensureSession creates a session when it does not exist', async () => {
    await killSession(TEST_SESSION);
    const result = await ensureSession(TEST_SESSION);
    expect(result.created).toBe(true);
    expect(await sessionExists(TEST_SESSION)).toBe(true);
  });
});

describe('listSessions', () => {
  const LIST_SESSION = 'dancode-list-test';

  afterAll(async () => {
    await killSession(LIST_SESSION);
  });

  it('returns an array of session names', async () => {
    await ensureSession(LIST_SESSION);
    const sessions = await listSessions();
    expect(Array.isArray(sessions)).toBe(true);
    expect(sessions).toContain(LIST_SESSION);
  });

  it('returns an empty array when no sessions match', async () => {
    // listSessions always returns an array (even if tmux server not running)
    const sessions = await listSessions();
    expect(Array.isArray(sessions)).toBe(true);
  });
});

describe('listWindows', () => {
  const WIN_SESSION = 'dancode-listwin-test';

  beforeEach(async () => {
    await killSession(WIN_SESSION);
  });

  afterAll(async () => {
    await killSession(WIN_SESSION);
  });

  it('returns empty array for non-existent session', async () => {
    const windows = await listWindows('nonexistent-session');
    expect(windows).toEqual([]);
  });

  it('returns windows with index and name for an existing session', async () => {
    await execFileAsync('tmux', ['new-session', '-d', '-s', WIN_SESSION, '-n', 'editor']);
    await execFileAsync('tmux', ['new-window', '-t', WIN_SESSION, '-n', 'shell']);

    const windows = await listWindows(WIN_SESSION);
    expect(windows).toHaveLength(2);
    expect(windows[0]).toEqual({ index: 0, name: 'editor' });
    expect(windows[1]).toEqual({ index: 1, name: 'shell' });
  });

  it('returns single window for a simple session', async () => {
    await createSession(WIN_SESSION);
    const windows = await listWindows(WIN_SESSION);
    expect(windows).toHaveLength(1);
    expect(windows[0].index).toBe(0);
    expect(typeof windows[0].name).toBe('string');
  });
});

describe('createProjectSession', () => {
  const PROJECT_SLUG = 'tmux-proj-test';
  const SESSION_NAME = `dancode-${PROJECT_SLUG}`;
  let tempDir;

  beforeEach(async () => {
    await killSession(SESSION_NAME);
    tempDir = await mkdtemp(join(tmpdir(), 'dancode-tmux-proj-'));
  });

  afterEach(async () => {
    await killSession(SESSION_NAME);
    await rm(tempDir, { recursive: true, force: true });
  });

  it('creates a tmux session named dancode-<slug>', async () => {
    const result = await createProjectSession(PROJECT_SLUG, tempDir);
    expect(result.sessionName).toBe(SESSION_NAME);
    expect(result.created).toBe(true);
    expect(await sessionExists(SESSION_NAME)).toBe(true);
  });

  it('creates two windows (CLI and Claude)', async () => {
    await createProjectSession(PROJECT_SLUG, tempDir);
    const { stdout } = await execFileAsync('tmux', [
      'list-windows', '-t', SESSION_NAME, '-F', '#{window_name}',
    ]);
    const windows = stdout.trim().split('\n');
    expect(windows).toHaveLength(2);
    expect(windows).toContain('cli');
    expect(windows).toContain('claude');
  });

  it('sets both windows to the project directory', async () => {
    await createProjectSession(PROJECT_SLUG, tempDir);
    const { stdout } = await execFileAsync('tmux', [
      'list-windows', '-t', SESSION_NAME, '-F', '#{pane_current_path}',
    ]);
    const paths = stdout.trim().split('\n');
    expect(paths).toHaveLength(2);
    for (const p of paths) {
      expect(p).toBe(tempDir);
    }
  });

  it('returns created: false for an existing session', async () => {
    await createProjectSession(PROJECT_SLUG, tempDir);
    const result = await createProjectSession(PROJECT_SLUG, tempDir);
    expect(result.created).toBe(false);
    expect(result.sessionName).toBe(SESSION_NAME);
  });
});

describe('createConnectionSession / destroyConnectionSession', () => {
  const PROJECT_SLUG = 'conn-sess-test';
  const SESSION_NAME = `dancode-${PROJECT_SLUG}`;
  let tempDir;

  beforeEach(async () => {
    await killSession(SESSION_NAME);
    tempDir = await mkdtemp(join(tmpdir(), 'dancode-conn-'));
    await createProjectSession(PROJECT_SLUG, tempDir);
  });

  afterEach(async () => {
    // Kill all sessions starting with our test session name
    try {
      const { stdout } = await execFileAsync('tmux', [
        'list-sessions', '-F', '#{session_name}',
      ]);
      for (const name of stdout.trim().split('\n')) {
        if (name.startsWith(SESSION_NAME)) {
          await killSession(name);
        }
      }
    } catch {
      // no sessions
    }
    await rm(tempDir, { recursive: true, force: true });
  });

  it('creates a grouped session that shares windows with the base session', async () => {
    const connSession = await createConnectionSession(SESSION_NAME, 0, 'test1');
    expect(connSession).toBe(`${SESSION_NAME}-conn-test1`);
    expect(await sessionExists(connSession)).toBe(true);
  });

  it('selects the requested window in the grouped session', async () => {
    const connSession = await createConnectionSession(SESSION_NAME, 1, 'test2');
    const { stdout } = await execFileAsync('tmux', [
      'display-message', '-t', connSession, '-p', '#{window_name}',
    ]);
    expect(stdout.trim()).toBe('claude');
  });

  it('disables the status bar in the grouped session', async () => {
    const connSession = await createConnectionSession(SESSION_NAME, 0, 'test3');
    const { stdout } = await execFileAsync('tmux', [
      'show-options', '-t', connSession, '-v', 'status',
    ]);
    expect(stdout.trim()).toBe('off');
  });

  it('destroyConnectionSession removes the grouped session', async () => {
    const connSession = await createConnectionSession(SESSION_NAME, 0, 'test4');
    expect(await sessionExists(connSession)).toBe(true);
    await destroyConnectionSession(connSession);
    expect(await sessionExists(connSession)).toBe(false);
  });

  it('destroyConnectionSession does not throw if session is already gone', async () => {
    await expect(destroyConnectionSession('nonexistent-session')).resolves.not.toThrow();
  });

  it('destroying a grouped session does not affect the base session', async () => {
    const connSession = await createConnectionSession(SESSION_NAME, 0, 'test5');
    await destroyConnectionSession(connSession);
    expect(await sessionExists(SESSION_NAME)).toBe(true);
  });
});
