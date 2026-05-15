/**
 * Server-side adapter that fronts a `dancode-shellhost` over a UNIX socket
 * with the same shape the rest of the server expects from `TerminalManager`.
 *
 * Only methods needed by `index.js` are implemented: create, list, get,
 * update, destroy, destroyAll. Plus a small per-terminal output ring buffer
 * is kept in memory so a reconnecting socket replays missed bytes (the
 * Phase 1 stand-in for Phase 2's disk-backed scrollback).
 */
import { validateSession } from './auth.js';
import { createShellhostClient } from 'dancode-shellhost/src/client.js';

const RING_BUFFER_SIZE = 50 * 1024; // ~50KB

class RingBuffer {
  constructor(maxSize = RING_BUFFER_SIZE) {
    this.maxSize = maxSize;
    this.chunks = [];
    this.totalSize = 0;
  }
  append(chunk) {
    this.chunks.push(chunk);
    this.totalSize += chunk.length;
    if (this.totalSize > this.maxSize * 2) this._compact();
  }
  _compact() {
    const combined = this.chunks.join('');
    if (combined.length > this.maxSize) {
      this.chunks = [combined.slice(combined.length - this.maxSize)];
    } else {
      this.chunks = [combined];
    }
    this.totalSize = this.chunks[0].length;
  }
  getContents() {
    const combined = this.chunks.join('');
    if (combined.length > this.maxSize) return combined.slice(combined.length - this.maxSize);
    return combined;
  }
}

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
      t.ring.append(data);
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
  }

  async _ensureConnected() {
    if (!this.client.connected) await this.client.connect();
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
      ring: new RingBuffer(),
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
      createdAt: entry.createdAt,
      lastActivity: entry.lastActivity,
    };
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
   * Attach a websocket. Replays buffered output and returns true.
   */
  attach(id, socket) {
    const t = this.terminals.get(id);
    if (!t) return false;
    t.sockets.add(socket);
    const buffered = t.ring.getContents();
    if (buffered) socket.emit('output', buffered);
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
export function setupShellhostNamespace(io, manager) {
  const ns = io.of(/^\/terminal\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);

  ns.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!validateSession(token)) {
      return next(new Error('Authentication failed'));
    }
    next();
  });

  ns.on('connection', (socket) => {
    const terminalId = socket.nsp.name.split('/').pop();

    const ok = manager.attach(terminalId, socket);
    if (!ok) {
      socket.emit('error', { message: 'Terminal not found' });
      socket.disconnect(true);
      return;
    }

    socket.on('input', (data) => {
      // socket.io sometimes wraps Buffer'd payloads; coerce to string.
      const str = typeof data === 'string' ? data : (data?.toString?.('utf8') ?? '');
      if (str) manager.write(terminalId, str).catch(() => {});
    });

    socket.on('resize', (payload) => {
      if (payload == null || typeof payload !== 'object') return;
      const { cols, rows } = payload;
      if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 1 || rows < 1) return;
      manager.resize(terminalId, cols, rows).catch(() => {});
    });

    socket.on('disconnect', () => {
      manager.detach(terminalId, socket);
    });
  });

  return ns;
}
