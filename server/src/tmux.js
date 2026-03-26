import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Enable mouse support globally so scroll-wheel works in all sessions.
 */
export async function enableMouse() {
  await execFileAsync('tmux', ['set', '-g', 'mouse', 'on']);
}

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
      'list-windows', '-t', `=${sessionName}`, '-F', '#{window_index}:#{window_name}',
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
    await execFileAsync('tmux', ['has-session', '-t', `=${name}`]);
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
 * If a session with the given name already exists, it is reused.
 *
 * @param {string} sessionName - tmux session name
 * @param {string} projectPath - absolute path to the project directory
 * @returns {Promise<{sessionName: string, created: boolean}>}
 */
export async function createProjectSession(sessionName, projectPath) {

  if (await sessionExists(sessionName)) {
    return { sessionName, created: false };
  }

  // Create session with window 0 (CLI) at the project path
  await execFileAsync('tmux', [
    'new-session', '-d', '-s', sessionName, '-n', 'cli', '-c', projectPath,
  ]);

  // Create window 1 (Claude) at the project path
  await execFileAsync('tmux', [
    'new-window', '-t', `=${sessionName}`, '-n', 'claude', '-c', projectPath,
  ]);

  // Run claude in window 1
  await execFileAsync('tmux', [
    'send-keys', '-t', `=${sessionName}:claude`,
    'claude --dangerously-skip-permissions', 'Enter',
  ]);

  // Select window 0 so the base session defaults to CLI
  await execFileAsync('tmux', [
    'select-window', '-t', `=${sessionName}:cli`,
  ]);

  return { sessionName, created: true };
}

/**
 * Rename an existing tmux session.
 * @param {string} oldName - current session name
 * @param {string} newName - desired new session name
 */
export async function renameSession(oldName, newName) {
  await execFileAsync('tmux', ['rename-session', '-t', `=${oldName}`, newName]);
}

/**
 * Create a grouped tmux session for a single-window connection.
 *
 * Grouped sessions share the same windows as the target session but have
 * independent view state (selected window, status bar, etc.). This lets
 * multiple browser terminals each display a different window from the same
 * underlying tmux session.
 *
 * @param {string} targetSession - the base session to group with (e.g. `myproj`)
 * @param {number} windowIndex - which window to display (0-based)
 * @param {string} connId - unique connection identifier for the grouped session name
 * @returns {Promise<string>} the grouped session name
 */
export async function createConnectionSession(targetSession, windowIndex, connId) {
  const connSession = `${targetSession}-conn-${connId}`;

  // Create grouped session (shares windows with target)
  await execFileAsync('tmux', [
    'new-session', '-d', '-t', `=${targetSession}`, '-s', connSession,
  ]);

  // Override status-left to show the base session name instead of the conn session name
  try {
    await execFileAsync('tmux', [
      'set', '-t', `=${connSession}`, 'status-left',
      `#[bg=colour208,fg=black,bold] ${targetSession} #[default] `,
    ]);
  } catch {}

  // Select the requested window — if it doesn't exist, the session still
  // works (just shows whatever window tmux defaults to)
  try {
    await execFileAsync('tmux', [
      'select-window', '-t', `=${connSession}:${windowIndex}`,
    ]);
  } catch {
    console.warn(`Window ${windowIndex} not found in session "${targetSession}", using default`);
  }

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
    await execFileAsync('tmux', ['kill-session', '-t', `=${connSession}`]);
  } catch {
    // Session already gone — that's fine
  }
}

/**
 * List all panes in a specific window of a tmux session.
 * @param {string} sessionName - tmux session name
 * @param {number} windowIndex - window index
 * @returns {Promise<Array<{index: number, command: string}>>}
 */
export async function listPanes(sessionName, windowIndex) {
  try {
    const { stdout } = await execFileAsync('tmux', [
      'list-panes', '-t', `=${sessionName}:${windowIndex}`,
      '-F', '#{pane_index}:#{pane_current_command}',
    ]);
    return stdout.trim().split('\n').filter(Boolean).map((line) => {
      const colonIdx = line.indexOf(':');
      return {
        index: parseInt(line.slice(0, colonIdx), 10),
        command: line.slice(colonIdx + 1),
      };
    });
  } catch {
    return [];
  }
}

/**
 * Break multi-pane windows into separate windows so each pane becomes
 * its own window. This lets DanCode's per-window connection logic work
 * with sessions that were set up using tmux pane splits.
 *
 * Idempotent: windows that already have a single pane are left alone.
 *
 * @param {string} sessionName - tmux session name
 * @returns {Promise<number>} number of panes that were broken out
 */
export async function breakPanesIntoWindows(sessionName) {
  const windows = await listWindows(sessionName);
  let brokenOut = 0;

  for (const win of windows) {
    const panes = await listPanes(sessionName, win.index);
    if (panes.length <= 1) continue;

    // Break panes in reverse order so indices stay stable
    for (let i = panes.length - 1; i >= 1; i--) {
      const pane = panes[i];
      await execFileAsync('tmux', [
        'break-pane', '-d',
        '-s', `=${sessionName}:${win.index}.${pane.index}`,
        '-n', pane.command,
      ]);
      brokenOut++;
    }
  }

  if (brokenOut > 0) {
    console.log(`Broke ${brokenOut} pane(s) into separate windows in session "${sessionName}"`);
  }
  return brokenOut;
}

/**
 * Rejoin separate single-pane windows back into panes within the first window.
 * Reverses what breakPanesIntoWindows() did.
 *
 * Idempotent: sessions with only one window are left alone.
 *
 * @param {string} sessionName - tmux session name
 * @returns {Promise<number>} number of windows that were joined back
 */
export async function joinWindowsIntoPanes(sessionName) {
  const windows = await listWindows(sessionName);
  if (windows.length <= 1) return 0;

  const sorted = [...windows].sort((a, b) => a.index - b.index);
  const target = sorted[0];
  let joined = 0;

  for (let i = 1; i < sorted.length; i++) {
    try {
      await execFileAsync('tmux', [
        'join-pane', '-d', '-h',
        '-s', `=${sessionName}:${sorted[i].index}`,
        '-t', `=${sessionName}:${target.index}`,
      ]);
      joined++;
    } catch {
      // Window may have been killed already
    }
  }

  if (joined > 0) {
    console.log(`Rejoined ${joined} window(s) into panes in session "${sessionName}"`);
  }
  return joined;
}

/**
 * Kill a specific window in a tmux session.
 * @param {string} sessionName - tmux session name
 * @param {number} windowIndex - window index to kill
 */
export async function killWindow(sessionName, windowIndex) {
  await execFileAsync('tmux', ['kill-window', '-t', `=${sessionName}:${windowIndex}`]);
}

/**
 * Kill an entire tmux session.
 * @param {string} sessionName - tmux session name
 */
export async function killSession(sessionName) {
  await execFileAsync('tmux', ['kill-session', '-t', `=${sessionName}`]);
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
    projects.map((p) => p.tmuxSession || p.slug)
  );
  return allSessions.filter(
    (name) => !mappedSessions.has(name) && !name.includes('-conn-')
  );
}

/**
 * Destroy all stale connection sessions (unattached -conn- sessions).
 * Called on server startup to clean up leftovers from ungraceful shutdowns.
 *
 * @returns {Promise<number>} number of sessions cleaned up
 */
export async function cleanupStaleConnSessions() {
  let cleaned = 0;
  try {
    const { stdout } = await execFileAsync('tmux', [
      'list-sessions', '-F', '#{session_name} #{session_attached}',
    ]);
    const stale = stdout.trim().split('\n').filter(Boolean)
      .filter((line) => {
        const [name, attached] = line.split(' ');
        return name.includes('-conn-') && attached === '0';
      })
      .map((line) => line.split(' ')[0]);

    for (const name of stale) {
      try {
        await execFileAsync('tmux', ['kill-session', '-t', `=${name}`]);
        cleaned++;
      } catch {}
    }
  } catch {
    // No tmux server or no sessions
  }
  if (cleaned > 0) {
    console.log(`Cleaned up ${cleaned} stale connection session(s)`);
  }
  return cleaned;
}
