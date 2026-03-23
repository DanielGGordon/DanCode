import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * List all tmux session names.
 * @returns {Promise<string[]>} array of session names (empty if no tmux server)
 */
export async function listSessions() {
  try {
    const { stdout } = await execFileAsync('tmux', [
      'list-sessions', '-F', '#{session_name}',
    ]);
    return stdout.trim().split('\n').filter(Boolean);
  } catch {
    // tmux server not running or no sessions
    return [];
  }
}

/**
 * List all windows in a tmux session.
 * @param {string} sessionName - tmux session name
 * @returns {Promise<Array<{index: number, name: string}>>} array of windows (empty if session doesn't exist)
 */
export async function listWindows(sessionName) {
  try {
    const { stdout } = await execFileAsync('tmux', [
      'list-windows', '-t', sessionName, '-F', '#{window_index}:#{window_name}',
    ]);
    return stdout.trim().split('\n').filter(Boolean).map((line) => {
      const colonIdx = line.indexOf(':');
      return {
        index: parseInt(line.slice(0, colonIdx), 10),
        name: line.slice(colonIdx + 1),
      };
    });
  } catch {
    return [];
  }
}

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
 * Create a tmux session for a DanCode project with two windows:
 *   - Window 0 (CLI): shell at the project directory
 *   - Window 1 (Claude): claude --dangerously-skip-permissions at the project directory
 *
 * Uses separate windows (not panes) so each can be independently attached
 * via grouped sessions for the multi-pane web UI.
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

  // Create session with window 0 (CLI) at the project path
  await execFileAsync('tmux', [
    'new-session', '-d', '-s', sessionName, '-n', 'cli', '-c', projectPath,
  ]);

  // Create window 1 (Claude) at the project path
  await execFileAsync('tmux', [
    'new-window', '-t', sessionName, '-n', 'claude', '-c', projectPath,
  ]);

  // Run claude in window 1
  await execFileAsync('tmux', [
    'send-keys', '-t', `${sessionName}:claude`,
    'claude --dangerously-skip-permissions', 'Enter',
  ]);

  // Select window 0 so the base session defaults to CLI
  await execFileAsync('tmux', [
    'select-window', '-t', `${sessionName}:cli`,
  ]);

  return { sessionName, created: true };
}

/**
 * Create a grouped tmux session for a single-window connection.
 *
 * Grouped sessions share the same windows as the target session but have
 * independent view state (selected window, status bar, etc.). This lets
 * multiple browser terminals each display a different window from the same
 * underlying tmux session.
 *
 * @param {string} targetSession - the base session to group with (e.g. `dancode-myproj`)
 * @param {number} windowIndex - which window to display (0-based)
 * @param {string} connId - unique connection identifier for the grouped session name
 * @returns {Promise<string>} the grouped session name
 */
export async function createConnectionSession(targetSession, windowIndex, connId) {
  const connSession = `${targetSession}-conn-${connId}`;

  // Batch all three operations into a single tmux invocation to minimise
  // process-spawn overhead (saves ~2 fork/exec cycles per pane, significant
  // on lower-powered hardware like Raspberry Pi).
  await execFileAsync('tmux', [
    'new-session', '-d', '-t', targetSession, '-s', connSession,
    ';',
    'set', '-t', connSession, 'status', 'off',
    ';',
    'select-window', '-t', `${connSession}:${windowIndex}`,
  ]);

  return connSession;
}

/**
 * Destroy a grouped connection session.
 * Safe to call even if the session doesn't exist.
 *
 * @param {string} connSession - the grouped session name to destroy
 */
export async function destroyConnectionSession(connSession) {
  try {
    await execFileAsync('tmux', ['kill-session', '-t', connSession]);
  } catch {
    // Session already gone — that's fine
  }
}

/**
 * Filter a list of tmux session names to only those that are "orphaned" —
 * not already mapped to a DanCode project and not internal connection sessions.
 *
 * @param {string[]} allSessions - all tmux session names
 * @param {Array<{slug: string, tmuxSession?: string}>} projects - configured projects
 * @returns {string[]} session names not mapped to any project
 */
export function getOrphanedSessions(allSessions, projects) {
  const mappedSessions = new Set(
    projects.map((p) => p.tmuxSession || `dancode-${p.slug}`)
  );
  return allSessions.filter(
    (name) => !mappedSessions.has(name) && !name.includes('-conn-')
  );
}
