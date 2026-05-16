/**
 * Server-side adapter that fronts a `dancode-shellhost` over a UNIX socket
 * with the same shape the rest of the server expects from `TerminalManager`.
 *
 * Only methods needed by `index.js` are implemented: create, list, get,
 * update, destroy, destroyAll. Reconnect replay comes from shellhost's
 * on-disk scrollback (Phase 2) — no server-memory ring buffer.
 */
import { validateSession } from './auth.js';
import { createShellhostClient } from 'dancode-shellhost/src/client.js';

export class ShellhostTerminalManager {
  /**
   * @param {object} options
   * @param {string} options.socketPath - path to shellhost UNIX socket
   * @param {object} [options.client] - pre-built client (tests)
   */
  constructor({ socketPath, client } = {}) {
    this.socketPath = socketPath;
    this.client = client || createShellhostClient({ socketPath });
    this.terminals = new Map(); // id -> { meta, sockets:Set, ring, exited, exitCode }
    this._wiredEvents = false;
    this._wireEvents();
  }

  _wireEvents() {
    if (this._wiredEvents) return;
    this._wiredEvents = true;
    this.client.on('output', (terminalId, payload) => {
      const t = this.terminals.get(terminalId);
      if (!t) return;
      const data = payload.data;
      t.lastActivity = new Date().toISOString();
      for (const sock of t.sockets) {
        sock.emit('output', data);
      }
    });
    this.client.on('exit', (terminalId, payload) => {
      const t = this.terminals.get(terminalId);
      if (!t) return;
      t.exited = true;
      t.exitCode = payload.exitCode;
      for (const sock of t.sockets) {
        sock.emit('session-exit', { exitCode: payload.exitCode });
      }
    });
    // Swallow client-side socket errors so a SIGKILLed shellhost (Phase 5
    // reboot simulation) doesn't crash the server with an "Unhandled error"
    // exception. The shellhost reconnect flow is driven explicitly by the
    // /test-only/restart-shellhost handler.
    this.client.on('error', (err) => {
      console.warn('[shellhost client] error:', err?.message || err);
    });
    this.client.on('close', () => {
      // Don't auto-reconnect here; reconnect is explicit (Phase 5 test
      // endpoint) so terminals stay in a known state during the gap.
    });
  }

  async _ensureConnected() {
    if (!this.client.connected) await this.client.connect();
  }

  /**
   * Rebuild the in-memory terminal map from shellhost. Called once on server
   * startup so that a fresh server process can pick up PTYs spawned before
   * its restart. Re-attaches to each terminal so output/exit events flow
   * through this manager again.
   *
   * Also pulls in any terminals shellhost has loaded as `needsRespawn` (Phase
   * 5: the shellhost itself restarted; the meta.json is on disk but no PTY
   * is alive yet). Those entries stay in the manager but are NOT attached
   * until they are respawned.
   *
   * Returns the number of terminals recovered (live + needs-respawn).
   */
  async recover() {
    await this._ensureConnected();
    const { terminals } = await this.client.list();
    if (!Array.isArray(terminals)) return 0;
    let recovered = 0;
    for (const t of terminals) {
      if (!t?.id) continue;
      if (this.terminals.has(t.id)) continue;
      const createdAt = t.createdAt || new Date().toISOString();
      const entry = {
        id: t.id,
        projectSlug: t.projectSlug,
        // No prior label is known after a server restart; downstream UI uses
        // the terminal id as the label when none is recorded.
        label: 'Terminal',
        command: t.command || null,
        cwd: t.cwd || null,
        createdAt,
        lastActivity: t.lastActiveAt || createdAt,
        sockets: new Set(),
        exited: !!t.exited,
        exitCode: t.exitCode ?? null,
        needsRespawn: !!t.needsRespawn,
      };
      this.terminals.set(t.id, entry);
      // Only attach if the terminal has a live PTY. needs-respawn entries
      // shouldn't trigger an attach: shellhost's attach replays scrollback,
      // and we don't want to fire any events until the user explicitly
      // re-opens the project and the server respawns the terminal.
      if (!entry.needsRespawn) {
        try { await this.client.attach(t.id); } catch { /* ignore */ }
      }
      recovered++;
    }
    return recovered;
  }

  /**
   * Respawn a needs-respawn terminal: fires shellhost's `respawn` op (which
   * emits the prior-session banner and starts a fresh PTY at the saved
   * cwd/command), then attaches so live output events flow.
   *
   * Idempotent: if the terminal is already live, this is a no-op.
   */
  async respawnTerminal(id) {
    const t = this.terminals.get(id);
    if (!t) return false;
    if (!t.needsRespawn) return true;
    await this._ensureConnected();
    try {
      await this.client.respawn(id);
    } catch {
      return false;
    }
    t.needsRespawn = false;
    try { await this.client.attach(id); } catch { /* idempotent */ }
    return true;
  }

  /**
   * Respawn every needs-respawn terminal for a project. Called server-side
   * when a project is opened so the user's prior layout comes back to life.
   *
   * Returns the number of terminals respawned.
   */
  async respawnForProject(projectSlug) {
    if (!projectSlug) return 0;
    let count = 0;
    for (const t of this.terminals.values()) {
      if (t.projectSlug !== projectSlug || !t.needsRespawn) continue;
      const ok = await this.respawnTerminal(t.id);
      if (ok) count++;
    }
    return count;
  }

  /**
   * Create a new terminal in shellhost. Returns public metadata.
   */
  async create({ projectSlug, label, command, cols = 80, rows = 24, cwd } = {}) {
    await this._ensureConnected();
    const { terminalId, terminal } = await this.client.spawn({
      projectSlug,
      cwd,
      command,
      cols,
      rows,
    });
    // Attach so we receive output/exit events for the whole lifetime.
    await this.client.attach(terminalId);

    const createdAt = terminal?.createdAt || new Date().toISOString();
    const entry = {
      id: terminalId,
      projectSlug,
      label: label || 'Terminal',
      command: command || null,
      cwd: terminal?.cwd || cwd || null,
      createdAt,
      lastActivity: createdAt,
      sockets: new Set(),
      exited: false,
      exitCode: null,
    };
    this.terminals.set(terminalId, entry);
    return this._publicMeta(entry);
  }

  _publicMeta(entry) {
    return {
      id: entry.id,
      projectSlug: entry.projectSlug,
      label: entry.label,
      cwd: entry.cwd || null,
      command: entry.command || null,
      createdAt: entry.createdAt,
      lastActivity: entry.lastActivity,
      needsRespawn: !!entry.needsRespawn,
    };
  }

  /**
   * Tear down the existing UNIX-socket client and build a fresh one. Used
   * after the shellhost process itself has been restarted (Phase 5 Pi
   * reboot simulation) so the server can re-establish a working session.
   *
   * After reconnect, `recover()` is called to repopulate the terminal map
   * with whatever the new shellhost reports.
   */
  async reconnect(socketPath) {
    if (socketPath) this.socketPath = socketPath;
    try { this.client.close(); } catch { /* ignore */ }
    this.client = createShellhostClient({ socketPath: this.socketPath });
    this._wiredEvents = false;
    this._wireEvents();
    // Clear in-memory entries that we previously attached to: after the
    // shellhost restart they are all needs-respawn anyway, and recover() is
    // about to re-add them from shellhost's list.
    this.terminals.clear();
    await this.client.connect();
    await this.recover();
  }

  get(id) {
    const t = this.terminals.get(id);
    if (!t) return null;
    return this._publicMeta(t);
  }

  list(projectSlug) {
    const out = [];
    for (const t of this.terminals.values()) {
      if (!projectSlug || t.projectSlug === projectSlug) out.push(this._publicMeta(t));
    }
    return out;
  }

  async update(id, updates) {
    const t = this.terminals.get(id);
    if (!t) return null;
    if (updates.label !== undefined) t.label = updates.label;
    return this._publicMeta(t);
  }

  async destroy(id) {
    const t = this.terminals.get(id);
    if (!t) return false;
    try {
      await this.client.kill(id);
    } catch { /* may already be dead */ }
    for (const sock of t.sockets) {
      try { sock.disconnect(true); } catch { /* ignore */ }
    }
    this.terminals.delete(id);
    return true;
  }

  async destroyAll() {
    const ids = [...this.terminals.keys()];
    for (const id of ids) {
      try { await this.destroy(id); } catch { /* ignore */ }
    }
  }

  /**
   * Attach a websocket. Replays disk-backed scrollback from shellhost
   * before live output starts flowing. Returns true if the terminal exists.
   *
   * Replay is fire-and-forget but ordered: we add the socket AFTER the
   * scrollback has been emitted, so live `output` events broadcast by the
   * shared shellhost listener cannot interleave ahead of the replay.
   */
  attach(id, socket) {
    const t = this.terminals.get(id);
    if (!t) return false;
    this.client.getScrollback(id).then((res) => {
      if (res?.data) {
        try { socket.emit('output', res.data); } catch { /* socket may have closed */ }
      }
      t.sockets.add(socket);
    }).catch(() => {
      // Even if scrollback fetch fails, still wire up the live stream so
      // the user sees future output.
      t.sockets.add(socket);
    });
    return true;
  }

  detach(id, socket) {
    const t = this.terminals.get(id);
    if (!t) return;
    t.sockets.delete(socket);
  }

  /**
   * Forward stdin from a websocket to shellhost.
   */
  async write(id, data) {
    const t = this.terminals.get(id);
    if (!t) return false;
    try {
      await this.client.write(id, data);
      return true;
    } catch {
      return false;
    }
  }

  async resize(id, cols, rows) {
    const t = this.terminals.get(id);
    if (!t) return false;
    try {
      await this.client.resize(id, cols, rows);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Optional close hook for graceful server shutdown.
   */
  close() {
    try { this.client.close(); } catch { /* ignore */ }
  }
}

/**
 * Mount the per-terminal Socket.IO namespace, bridging to the shellhost-backed
 * manager. Mirrors `setupTerminalManagerNamespace` from the legacy
 * terminal-manager but writes go through shellhost.
 */
export function setupShellhostNamespace(io, managerOrGetter) {
  // Accept either a manager instance or a getter so the namespace resolves to
  // the current manager after an in-process server restart.
  const resolve = typeof managerOrGetter === 'function'
    ? managerOrGetter
    : () => managerOrGetter;

  const ns = io.of(/^\/terminal\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);

  ns.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!validateSession(token)) {
      return next(new Error('Authentication failed'));
    }
    next();
  });

  ns.on('connection', async (socket) => {
    const terminalId = socket.nsp.name.split('/').pop();
    const manager = resolve();

    // Phase 5: if the terminal is recovered-but-not-respawned (the shellhost
    // restarted between sessions), respawn it before attaching so live
    // output flows immediately.
    try {
      const entry = manager.terminals?.get(terminalId);
      if (entry?.needsRespawn) {
        await manager.respawnTerminal(terminalId);
      }
    } catch { /* fall through to attach which will surface the error */ }

    const ok = manager.attach(terminalId, socket);
    if (!ok) {
      socket.emit('error', { message: 'Terminal not found' });
      socket.disconnect(true);
      return;
    }

    socket.on('input', (data) => {
      // socket.io sometimes wraps Buffer'd payloads; coerce to string.
      const str = typeof data === 'string' ? data : (data?.toString?.('utf8') ?? '');
      if (str) resolve().write(terminalId, str).catch(() => {});
    });

    socket.on('resize', (payload) => {
      if (payload == null || typeof payload !== 'object') return;
      const { cols, rows } = payload;
      if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 1 || rows < 1) return;
      resolve().resize(terminalId, cols, rows).catch(() => {});
    });

    socket.on('disconnect', () => {
      resolve().detach(terminalId, socket);
    });
  });

  return ns;
}
