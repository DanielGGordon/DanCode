import { describe, it, expect, afterAll, afterEach, beforeEach } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { sessionExists, createSession, ensureSession, createProjectSession, createConnectionSession, destroyConnectionSession, listSessions, listWindows, getOrphanedSessions } from '../src/tmux.js';

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

describe('getOrphanedSessions', () => {
  it('returns all sessions when there are no projects', () => {
    const sessions = ['my-session', 'another-session'];
    const projects = [];
    expect(getOrphanedSessions(sessions, projects)).toEqual(['my-session', 'another-session']);
  });

  it('returns empty array when there are no sessions', () => {
    const projects = [{ slug: 'foo', name: 'Foo' }];
    expect(getOrphanedSessions([], projects)).toEqual([]);
  });

  it('filters out dancode-<slug> sessions that match a project', () => {
    const sessions = ['dancode-my-project', 'dancode-other', 'unrelated'];
    const projects = [{ slug: 'my-project', name: 'My Project' }];
    const orphaned = getOrphanedSessions(sessions, projects);
    expect(orphaned).toEqual(['dancode-other', 'unrelated']);
  });

  it('filters out sessions matching project.tmuxSession for adopted projects', () => {
    const sessions = ['my-custom-session', 'dancode-adopted', 'orphan'];
    const projects = [{ slug: 'adopted', name: 'Adopted', tmuxSession: 'my-custom-session' }];
    const orphaned = getOrphanedSessions(sessions, projects);
    // my-custom-session is mapped via tmuxSession, dancode-adopted is NOT mapped
    // because the project uses tmuxSession override
    expect(orphaned).toContain('dancode-adopted');
    expect(orphaned).not.toContain('my-custom-session');
    expect(orphaned).toContain('orphan');
  });

  it('uses tmuxSession over dancode-<slug> when both could match', () => {
    // Project has tmuxSession set, so dancode-<slug> is NOT considered mapped
    const sessions = ['custom-sess', 'dancode-proj'];
    const projects = [{ slug: 'proj', name: 'Proj', tmuxSession: 'custom-sess' }];
    const orphaned = getOrphanedSessions(sessions, projects);
    expect(orphaned).toEqual(['dancode-proj']);
  });

  it('filters out connection sessions (containing -conn-)', () => {
    const sessions = ['dancode-proj-conn-abc', 'dancode-proj-conn-def', 'real-session'];
    const projects = [];
    const orphaned = getOrphanedSessions(sessions, projects);
    expect(orphaned).toEqual(['real-session']);
  });

  it('filters out both mapped and connection sessions simultaneously', () => {
    const sessions = [
      'dancode-alpha',         // mapped via slug
      'my-adopted-session',    // mapped via tmuxSession
      'dancode-alpha-conn-1',  // connection session
      'orphan-session',        // not mapped, not a connection
    ];
    const projects = [
      { slug: 'alpha', name: 'Alpha' },
      { slug: 'beta', name: 'Beta', tmuxSession: 'my-adopted-session' },
    ];
    const orphaned = getOrphanedSessions(sessions, projects);
    expect(orphaned).toEqual(['orphan-session']);
  });

  it('does not filter out sessions with similar but non-matching names', () => {
    const sessions = ['dancode-my-project-extra', 'dancode-my-project'];
    const projects = [{ slug: 'my-project', name: 'My Project' }];
    const orphaned = getOrphanedSessions(sessions, projects);
    // Only exact match is filtered
    expect(orphaned).toEqual(['dancode-my-project-extra']);
  });

  it('handles multiple projects with a mix of adopted and regular', () => {
    const sessions = [
      'dancode-regular',
      'dancode-another',
      'custom-tmux',
      'stray-session',
    ];
    const projects = [
      { slug: 'regular', name: 'Regular' },
      { slug: 'adopted', name: 'Adopted', tmuxSession: 'custom-tmux' },
    ];
    const orphaned = getOrphanedSessions(sessions, projects);
    expect(orphaned).toEqual(['dancode-another', 'stray-session']);
  });
});
