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

/**
 * Create a tmux session for a DanCode project with two panes:
 *   - Pane 0: shell at the project directory
 *   - Pane 1: claude --dangerously-skip-permissions at the project directory
 *
 * If a session with the name `dancode-<slug>` already exists, it is reused.
 *
 * @param {string} slug - project slug (session will be named `dancode-<slug>`)
 * @param {string} projectPath - absolute path to the project directory
 * @returns {Promise<{sessionName: string, created: boolean}>}
 */
export async function createProjectSession(slug, projectPath) {
  const sessionName = `dancode-${slug}`;

  if (await sessionExists(sessionName)) {
    return { sessionName, created: false };
  }

  // Create session with pane 0 at the project path
  await execFileAsync('tmux', [
    'new-session', '-d', '-s', sessionName, '-c', projectPath,
  ]);

  // Split horizontally to create pane 1 at the project path
  await execFileAsync('tmux', [
    'split-window', '-t', sessionName, '-h', '-c', projectPath,
  ]);

  // Run claude in pane 1
  await execFileAsync('tmux', [
    'send-keys', '-t', `${sessionName}:0.1`,
    'claude --dangerously-skip-permissions', 'Enter',
  ]);

  return { sessionName, created: true };
}
