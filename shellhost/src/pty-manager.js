import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import pty from 'node-pty';

/**
 * Owns the in-memory map of live PTYs. Pure logic — no socket awareness.
 *
 * Each terminal:
 *   { id, projectSlug, cwd, command, createdAt, lastActiveAt,
 *     pty, listeners: Set<fn>, exitListeners: Set<fn>, exited, exitCode }
 *
 * Caller wires the listener callbacks to whatever transport sends events
 * back to the server. Detach simply removes a listener; the PTY keeps running.
 * Only `kill` actually terminates the underlying process.
 */
export class PTYManager {
  /**
   * @param {object} [options]
   * @param {(opts)=>pty.IPty} [options.spawn] - injectable for tests
   */
  constructor({ spawn = pty.spawn.bind(pty) } = {}) {
    this._spawn = spawn;
    this.terminals = new Map();
  }

  /**
   * Spawn a new PTY. Returns the public metadata (no internal refs).
   * @param {object} opts
   * @param {string} opts.projectSlug
   * @param {string} [opts.cwd]
   * @param {string} [opts.command]   shell command line to run; default = login shell
   * @param {number} [opts.cols=80]
   * @param {number} [opts.rows=24]
   */
  spawn({ projectSlug, cwd, command, cols = 80, rows = 24 } = {}) {
    if (!projectSlug || typeof projectSlug !== 'string') {
      throw new TypeError('spawn: projectSlug is required');
    }
    const id = randomUUID();
    const createdAt = new Date().toISOString();

    const shellPath = process.env.SHELL || '/bin/bash';
    let file;
    let args;
    if (command && typeof command === 'string' && command.length > 0) {
      // Run the supplied command via the user's login shell so PATH/aliases work.
      file = shellPath;
      args = ['-lc', command];
    } else {
      file = shellPath;
      args = ['-l'];
    }

    const env = {
      ...process.env,
      TERM: 'xterm-256color',
    };

    const ptyProcess = this._spawn(file, args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: cwd || process.env.HOME || homedir(),
      env,
    });

    const terminal = {
      id,
      projectSlug,
      cwd: cwd || process.env.HOME || homedir(),
      command: command || null,
      createdAt,
      lastActiveAt: createdAt,
      pty: ptyProcess,
      listeners: new Set(),
      exitListeners: new Set(),
      exited: false,
      exitCode: null,
      cols,
      rows,
    };

    ptyProcess.onData((data) => {
      terminal.lastActiveAt = new Date().toISOString();
      for (const fn of terminal.listeners) {
        try { fn(data); } catch { /* listener crash must not stop the stream */ }
      }
    });

    ptyProcess.onExit(({ exitCode, signal }) => {
      terminal.exited = true;
      terminal.exitCode = exitCode ?? (signal ? 128 + signal : 0);
      for (const fn of terminal.exitListeners) {
        try { fn({ exitCode: terminal.exitCode, signal: signal ?? null }); } catch { /* ignore */ }
      }
    });

    this.terminals.set(id, terminal);
    return this._publicMeta(terminal);
  }

  /**
   * Register a listener for output / exit events on a terminal.
   * Returns a detach function (idempotent).
   *
   * The listener receives output as a string. `onExit` receives
   * `{ exitCode, signal }`.
   */
  attach(id, { onOutput, onExit } = {}) {
    const terminal = this.terminals.get(id);
    if (!terminal) return null;
    if (onOutput) terminal.listeners.add(onOutput);
    if (onExit) terminal.exitListeners.add(onExit);

    // If the PTY has already exited, fire the exit listener immediately.
    if (terminal.exited && onExit) {
      try { onExit({ exitCode: terminal.exitCode, signal: null }); } catch { /* ignore */ }
    }

    let detached = false;
    return () => {
      if (detached) return;
      detached = true;
      if (onOutput) terminal.listeners.delete(onOutput);
      if (onExit) terminal.exitListeners.delete(onExit);
    };
  }

  /**
   * Forget the given listeners for a terminal (no-op if not present).
   */
  detach(id, { onOutput, onExit } = {}) {
    const terminal = this.terminals.get(id);
    if (!terminal) return false;
    if (onOutput) terminal.listeners.delete(onOutput);
    if (onExit) terminal.exitListeners.delete(onExit);
    return true;
  }

  /**
   * Write bytes to a terminal's stdin.
   */
  write(id, data) {
    const terminal = this.terminals.get(id);
    if (!terminal) return false;
    if (terminal.exited) return false;
    terminal.pty.write(data);
    terminal.lastActiveAt = new Date().toISOString();
    return true;
  }

  /**
   * Resize a terminal.
   */
  resize(id, cols, rows) {
    const terminal = this.terminals.get(id);
    if (!terminal) return false;
    if (terminal.exited) return false;
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 1 || rows < 1) {
      return false;
    }
    try {
      terminal.pty.resize(cols, rows);
      terminal.cols = cols;
      terminal.rows = rows;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Kill a terminal and remove it. Returns true if removed.
   */
  kill(id, signal = 'SIGHUP') {
    const terminal = this.terminals.get(id);
    if (!terminal) return false;
    try {
      terminal.pty.kill(signal);
    } catch { /* already dead */ }
    this.terminals.delete(id);
    return true;
  }

  /**
   * Return public metadata for one terminal, or null.
   */
  inspect(id) {
    const terminal = this.terminals.get(id);
    if (!terminal) return null;
    return this._publicMeta(terminal);
  }

  /**
   * Return public metadata for all live terminals, optionally filtered.
   */
  list(filter = {}) {
    const out = [];
    for (const terminal of this.terminals.values()) {
      if (filter.projectSlug && terminal.projectSlug !== filter.projectSlug) continue;
      out.push(this._publicMeta(terminal));
    }
    return out;
  }

  /**
   * Kill every terminal (used on shutdown).
   */
  killAll() {
    const ids = [...this.terminals.keys()];
    for (const id of ids) this.kill(id);
  }

  _publicMeta(terminal) {
    return {
      id: terminal.id,
      projectSlug: terminal.projectSlug,
      cwd: terminal.cwd,
      command: terminal.command,
      createdAt: terminal.createdAt,
      lastActiveAt: terminal.lastActiveAt,
      cols: terminal.cols,
      rows: terminal.rows,
      pid: terminal.pty?.pid ?? null,
      exited: terminal.exited,
      exitCode: terminal.exitCode,
    };
  }
}
