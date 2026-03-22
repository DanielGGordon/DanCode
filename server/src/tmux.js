import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Check whether a tmux session with the given name exists.
 * @param {string} name - tmux session name
 * @returns {Promise<boolean>}
 */
export async function sessionExists(name) {
  try {
    await execFileAsync('tmux', ['has-session', '-t', name]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a detached tmux session with the given name.
 * @param {string} name - tmux session name
 */
export async function createSession(name) {
  await execFileAsync('tmux', ['new-session', '-d', '-s', name]);
}

/**
 * Ensure a tmux session exists, creating it if necessary.
 * @param {string} name - tmux session name
 * @returns {Promise<{created: boolean}>} whether a new session was created
 */
export async function ensureSession(name) {
  if (await sessionExists(name)) {
    console.log(`tmux session "${name}" already exists`);
    return { created: false };
  }
  await createSession(name);
  console.log(`tmux session "${name}" created`);
  return { created: true };
}
