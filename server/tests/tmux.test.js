import { describe, it, expect, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { sessionExists, createSession, ensureSession } from '../src/tmux.js';

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
