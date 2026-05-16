import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import pty from 'node-pty';

/**
 * Owns the in-memory map of live (or recoverable) PTYs. Pure logic — no
 * socket awareness.
 *
 * Each terminal entry:
 *   {
 *     id, projectSlug, cwd, command, createdAt, lastActiveAt,
 *     pty | null,           // null while needsRespawn
 *     needsRespawn,         // true if loaded from disk and not yet spawned
 *     listeners: Set<fn>, exitListeners: Set<fn>,
 *     exited, exitCode, cols, rows,
 *   }
 *
 * Caller wires the listener callbacks to whatever transport sends events
 * back to the server. Detach simply removes a listener; the PTY keeps
 * running. Only `kill` actually terminates the underlying process.
 *
 * Optional collaborators:
 *   - `scrollback`: every PTY output chunk is appended to it write-through.
 *   - `metaStore`: every spawn writes a meta.json; a periodic flusher
 *     rewrites `lastActiveAt` so a freshly-restarted shellhost can show an
 *     accurate "prior session ended at" banner.
 */
export class PTYManager {
  /**
   * @param {object} [options]
   * @param {(opts)=>pty.IPty} [options.spawn] - injectable for tests
   * @param {object} [options.scrollback] - optional ScrollbackStore
   * @param {object} [options.metaStore] - optional MetaStore
   * @param {number} [options.lastActiveFlushIntervalMs] - default 60s
   */
  constructor({
    spawn = pty.spawn.bind(pty),
    scrollback = null,
    metaStore = null,
    lastActiveFlushIntervalMs = 60_000,
  } = {}) {
    this._spawn = spawn;
    this.scrollback = scrollback;
    this.metaStore = metaStore;
    this.lastActiveFlushIntervalMs = lastActiveFlushIntervalMs;
    this.terminals = new Map();
    this._lastActiveFlusher = null;
    this._lastActiveDirty = new Set();
    if (this.metaStore && this.lastActiveFlushIntervalMs > 0) {
      this._startLastActiveFlusher();
    }
  }

  _startLastActiveFlusher() {
    // setInterval honours vi.advanceTimersByTime in tests; clean up on stop.
    this._lastActiveFlusher = setInterval(() => {
      this._flushLastActive();
    }, this.lastActiveFlushIntervalMs);
    // Don't keep the process alive solely for this timer.
    if (this._lastActiveFlusher?.unref) this._lastActiveFlusher.unref();
  }

  /**
   * Stop the periodic lastActiveAt flusher. Called on shutdown.
   */
  stopLastActiveFlusher() {
    if (this._lastActiveFlusher) {
      clearInterval(this._lastActiveFlusher);
      this._lastActiveFlusher = null;
    }
  }

  /**
   * Write the current `lastActiveAt` for every dirty terminal to disk.
   * Called on the periodic timer and on shutdown.
   */
  _flushLastActive() {
    if (!this.metaStore) return;
    const ids = [...this._lastActiveDirty];
    this._lastActiveDirty.clear();
    for (const id of ids) {
      const t = this.terminals.get(id);
      if (!t) continue;
      try {
        this.metaStore.update(id, { lastActiveAt: t.lastActiveAt });
      } catch { /* ignore */ }
    }
  }

  /**
   * Spawn a new PTY. Returns the public metadata (no internal refs).
   */
  spawn({ projectSlug, cwd, command, cols = 80, rows = 24 } = {}) {
    if (!projectSlug || typeof projectSlug !== 'string') {
      throw new TypeError('spawn: projectSlug is required');
    }
    const id = randomUUID();
    return this._spawnInternal({
      id,
      projectSlug,
      cwd: cwd || process.env.HOME || homedir(),
      command: command || null,
      cols,
      rows,
      createdAt: new Date().toISOString(),
    });
  }

  /**
   * Internal helper: spawn a PTY for a given terminal record (whether it's
   * a brand-new id or a respawned one).
   */
  _spawnInternal({ id, projectSlug, cwd, command, cols, rows, createdAt }) {
    const shellPath = process.env.SHELL || '/bin/bash';
    let file;
    let args;
    if (command && typeof command === 'string' && command.length > 0) {
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
      cwd,
      env,
    });

    const now = new Date().toISOString();
    // Reuse the existing record if this is a respawn so attached listeners
    // remain wired.
    const existing = this.terminals.get(id);
    const terminal = existing || {
      id,
      projectSlug,
      cwd,
      command,
      createdAt: createdAt || now,
      lastActiveAt: now,
      listeners: new Set(),
      exitListeners: new Set(),
      cols,
      rows,
    };
    terminal.projectSlug = projectSlug;
    terminal.cwd = cwd;
    terminal.command = command;
    terminal.cols = cols;
    terminal.rows = rows;
    terminal.pty = ptyProcess;
    terminal.needsRespawn = false;
    terminal.exited = false;
    terminal.exitCode = null;
    terminal.lastActiveAt = now;

    ptyProcess.onData((data) => {
      terminal.lastActiveAt = new Date().toISOString();
      this._lastActiveDirty.add(terminal.id);
      if (this.scrollback) {
        try { this.scrollback.append(terminal.id, data); } catch { /* keep streaming */ }
      }
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

    // Persist meta on every (re)spawn so a fresh shellhost can reconstruct.
    if (this.metaStore) {
      try {
        this.metaStore.writeSync({
          id: terminal.id,
          projectSlug: terminal.projectSlug,
          cwd: terminal.cwd,
          command: terminal.command,
          createdAt: terminal.createdAt,
          lastActiveAt: terminal.lastActiveAt,
        });
      } catch { /* best effort */ }
    }

    return this._publicMeta(terminal);
  }

  /**
   * Scan the meta store for orphaned terminals (PTYs that died with the
   * previous shellhost). Each gets a `needsRespawn` placeholder entry in
   * the in-memory map. Returns `{ loaded, ids }`.
   */
  loadOrphans() {
    if (!this.metaStore) return { loaded: 0, ids: [] };
    const metas = this.metaStore.list();
    const ids = [];
    for (const meta of metas) {
      if (this.terminals.has(meta.id)) continue;
      this.terminals.set(meta.id, {
        id: meta.id,
        projectSlug: meta.projectSlug,
        cwd: meta.cwd,
        command: meta.command || null,
        createdAt: meta.createdAt || null,
        lastActiveAt: meta.lastActiveAt || null,
        claudeSessionId: meta.claudeSessionId || null,
        listeners: new Set(),
        exitListeners: new Set(),
        cols: meta.cols || 80,
        rows: meta.rows || 24,
        pty: null,
        needsRespawn: true,
        exited: false,
        exitCode: null,
      });
      ids.push(meta.id);
    }
    return { loaded: ids.length, ids };
  }

  /**
   * Respawn a terminal that is marked `needsRespawn`. Emits the prior
   * scrollback tail + a banner (`--- prior session ended at <ISO> ---`) to
   * every currently-attached listener, persists the banner so future
   * attaches see it via replay, then spawns a fresh PTY at the saved cwd
   * with the saved command.
   *
   * If the terminal is already live (not needs-respawn), returns its public
   * metadata without re-spawning.
   *
   * Returns the public metadata of the (now live) terminal.
   */
  respawn(id) {
    const terminal = this.terminals.get(id);
    if (!terminal) throw new Error(`respawn: terminal ${id} not found`);
    if (!terminal.needsRespawn && terminal.pty) {
      return this._publicMeta(terminal);
    }

    const lastActive = terminal.lastActiveAt || new Date().toISOString();
    const banner = `\r\n\x1b[33m--- prior session ended at ${lastActive} ---\x1b[0m\r\n`;

    // Persist the banner so future attaches see it in replay. We persist
    // BEFORE notifying listeners so on-disk and live streams agree.
    if (this.scrollback) {
      try { this.scrollback.append(id, banner); } catch { /* ignore */ }
    }

    // Notify every attached listener with the banner as a synthetic chunk.
    for (const fn of terminal.listeners) {
      try { fn(banner); } catch { /* ignore */ }
    }

    // Now spawn the fresh PTY. The PTY's onData callback wires through
    // scrollback + listeners exactly the same as a brand-new spawn, so
    // history continues to grow in the same scrollback.log.
    return this._spawnInternal({
      id,
      projectSlug: terminal.projectSlug,
      cwd: terminal.cwd,
      command: terminal.command,
      cols: terminal.cols,
      rows: terminal.rows,
      createdAt: terminal.createdAt || new Date().toISOString(),
    });
  }

  /**
   * Register a listener for output / exit events on a terminal.
   * Returns a detach function (idempotent).
   */
  attach(id, { onOutput, onExit } = {}) {
    const terminal = this.terminals.get(id);
    if (!terminal) return null;
    if (onOutput) terminal.listeners.add(onOutput);
    if (onExit) terminal.exitListeners.add(onExit);

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

  detach(id, { onOutput, onExit } = {}) {
    const terminal = this.terminals.get(id);
    if (!terminal) return false;
    if (onOutput) terminal.listeners.delete(onOutput);
    if (onExit) terminal.exitListeners.delete(onExit);
    return true;
  }

  write(id, data) {
    const terminal = this.terminals.get(id);
    if (!terminal) return false;
    if (terminal.exited || !terminal.pty) return false;
    terminal.pty.write(data);
    terminal.lastActiveAt = new Date().toISOString();
    this._lastActiveDirty.add(terminal.id);
    return true;
  }

  resize(id, cols, rows) {
    const terminal = this.terminals.get(id);
    if (!terminal) return false;
    if (terminal.exited || !terminal.pty) return false;
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

  kill(id, signal = 'SIGHUP') {
    const terminal = this.terminals.get(id);
    if (!terminal) return false;
    if (terminal.pty) {
      try { terminal.pty.kill(signal); } catch { /* already dead */ }
    }
    this.terminals.delete(id);
    this._lastActiveDirty.delete(id);
    // Both stores' state lives under <baseDir>/<id>/ — scrollback owns the
    // whole directory; once it tears the dir down, meta is gone too.
    if (this.scrollback) {
      try { this.scrollback.removeTerminal(id); } catch { /* ignore */ }
    } else if (this.metaStore) {
      try { this.metaStore.remove(id); } catch { /* ignore */ }
    }
    return true;
  }

  getScrollback(id) {
    if (!this.scrollback) return '';
    return this.scrollback.readTail(id);
  }

  inspect(id) {
    const terminal = this.terminals.get(id);
    if (!terminal) return null;
    return this._publicMeta(terminal);
  }

  list(filter = {}) {
    const out = [];
    for (const terminal of this.terminals.values()) {
      if (filter.projectSlug && terminal.projectSlug !== filter.projectSlug) continue;
      out.push(this._publicMeta(terminal));
    }
    return out;
  }

  killAll() {
    const ids = [...this.terminals.keys()];
    for (const id of ids) this.kill(id);
    this.stopLastActiveFlusher();
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
      needsRespawn: !!terminal.needsRespawn,
    };
  }
}
