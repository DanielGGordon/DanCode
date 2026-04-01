import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const TMUX = 'tmux';
const SESSION_PREFIX = 'dancode-';

/**
 * Build the tmux session name for a terminal.
 * Format: dancode-{projectSlug}-{terminalId}
 */
export function sessionName(projectSlug, terminalId) {
  return `${SESSION_PREFIX}${projectSlug}-${terminalId}`;
}

/**
 * Create a new detached tmux session.
 */
export async function createSession(name, { cols = 80, rows = 24, cwd } = {}) {
  const args = [
    'new-session', '-d',
    '-s', name,
    '-x', String(cols),
    '-y', String(rows),
  ];
  if (cwd) {
    args.push('-c', cwd);
  }
  await execFileAsync(TMUX, args);
  // Disable all tmux chrome so the full terminal area is available to the shell pane.
  // DanCode tmux sessions are invisible to the client — no UI chrome needed.
  await execFileAsync(TMUX, ['set-option', '-t', name, 'status', 'off']);
  await execFileAsync(TMUX, ['set-option', '-t', name, 'escape-time', '0']);
  await execFileAsync(TMUX, ['set-window-option', '-t', name, 'pane-border-status', 'off']);
  // Reclaim any rows freed by turning off status/borders.
  await execFileAsync(TMUX, ['resize-pane', '-t', name, '-y', String(rows)]);
}

/**
 * Check if a tmux session exists.
 */
export async function hasSession(name) {
  try {
    await execFileAsync(TMUX, ['has-session', '-t', name]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Kill a tmux session.
 */
export async function killSession(name) {
  try {
    await execFileAsync(TMUX, ['kill-session', '-t', name]);
  } catch {
    // session may already be dead
  }
}

/**
 * Capture the scrollback buffer from a tmux pane.
 * Returns the captured text.
 */
export async function capturePane(name) {
  try {
    const { stdout } = await execFileAsync(TMUX, [
      'capture-pane', '-t', name, '-p', '-S', '-1000',
    ]);
    return stdout;
  } catch {
    return '';
  }
}

/**
 * Resize a tmux pane to the given dimensions.
 * Also ensures pane-border-status is off so the pane fills the window.
 */
export async function resizePane(name, cols, rows) {
  try {
    await execFileAsync(TMUX, ['set-window-option', '-t', name, 'pane-border-status', 'off']);
    await execFileAsync(TMUX, ['resize-pane', '-t', name, '-x', String(cols), '-y', String(rows)]);
  } catch {
    // session may not exist
  }
}

/**
 * Send keys to a tmux session.
 */
export async function sendKeys(name, keys) {
  await execFileAsync(TMUX, ['send-keys', '-t', name, keys, 'Enter']);
}

/**
 * List all DanCode-managed tmux sessions (those starting with 'dancode-').
 * Returns an array of session name strings.
 */
export async function listDancodeSessions() {
  try {
    const { stdout } = await execFileAsync(TMUX, [
      'list-sessions', '-F', '#{session_name}',
    ]);
    return stdout.trim().split('\n').filter((s) => s.startsWith(SESSION_PREFIX));
  } catch {
    // tmux server not running or no sessions
    return [];
  }
}
