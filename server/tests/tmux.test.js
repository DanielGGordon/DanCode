import { describe, it, expect, afterAll, afterEach, beforeEach } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { sessionExists, createSession, ensureSession, createProjectSession } from '../src/tmux.js';

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

  it('creates two panes', async () => {
    await createProjectSession(PROJECT_SLUG, tempDir);
    const { stdout } = await execFileAsync('tmux', [
      'list-panes', '-t', SESSION_NAME, '-F', '#{pane_index}',
    ]);
    const panes = stdout.trim().split('\n');
    expect(panes).toHaveLength(2);
    expect(panes).toContain('0');
    expect(panes).toContain('1');
  });

  it('sets both panes to the project directory', async () => {
    await createProjectSession(PROJECT_SLUG, tempDir);
    const { stdout } = await execFileAsync('tmux', [
      'list-panes', '-t', SESSION_NAME, '-F', '#{pane_current_path}',
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
