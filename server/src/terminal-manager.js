import pty from 'node-pty';
import { randomUUID } from 'node:crypto';
import { writeFile, rm, mkdir, readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { validateSession } from './auth.js';
import {
  sessionName as tmuxSessionName,
  createSession as tmuxCreateSession,
  hasSession as tmuxHasSession,
  killSession as tmuxKillSession,
  capturePane as tmuxCapturePane,
  sendKeys as tmuxSendKeys,
  resizePane as tmuxResizePane,
  listDancodeSessions,
} from './tmux.js';

const RING_BUFFER_SIZE = 50 * 1024; // ~50KB

/**
 * Returns the default directory for terminal metadata files.
 */
export function getTerminalsDir() {
  return join(homedir(), '.dancode', 'terminals');
}

/**
 * Simple ring buffer that keeps the last ~maxSize bytes of text.
 */
class RingBuffer {
  constructor(maxSize = RING_BUFFER_SIZE) {
    this.maxSize = maxSize;
    this.data = '';
  }

  append(chunk) {
    this.data += chunk;
    if (this.data.length > this.maxSize) {
      this.data = this.data.slice(this.data.length - this.maxSize);
    }
  }

  getContents() {
    return this.data;
  }
}

/**
 * Manages PTY terminal processes backed by tmux sessions.
 * Each terminal runs inside a tmux session named dancode-{projectSlug}-{terminalId}.
 * The node-pty process attaches to the tmux session, providing I/O relay to WebSocket clients.
 * Processes survive server restarts; on startup, reconcile() reattaches to existing tmux sessions.
 */
export class TerminalManager {
  /**
   * @param {string} [terminalsDir] - directory for terminal metadata JSON files
   */
  constructor(terminalsDir) {
    this.terminalsDir = terminalsDir || getTerminalsDir();
    this.terminals = new Map();
  }

  /**
   * Create a new terminal with a PTY process inside a tmux session.
   */
  async create({ projectSlug, label, command, cols = 80, rows = 24, cwd }) {
    const id = randomUUID();
    const createdAt = new Date().toISOString();

    if (!existsSync(this.terminalsDir)) {
      await mkdir(this.terminalsDir, { recursive: true });
    }

    const tmuxName = tmuxSessionName(projectSlug, id);

    // Create a detached tmux session
    await tmuxCreateSession(tmuxName, { cols, rows, cwd: cwd || process.env.HOME });

    // If a startup command is requested, send it to the tmux session
    if (command) {
      await tmuxSendKeys(tmuxName, command);
    }

    // Attach node-pty to the tmux session for I/O relay
    const ptyProcess = pty.spawn('tmux', ['attach-session', '-t', tmuxName], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: cwd || process.env.HOME,
      env: process.env,
    });

    const ringBuffer = new RingBuffer();

    ptyProcess.onData((data) => {
      ringBuffer.append(data);
      const terminal = this.terminals.get(id);
      if (terminal) {
        for (const socket of terminal.sockets) {
          socket.emit('output', data);
        }
      }
    });

    ptyProcess.onExit(async () => {
      const terminal = this.terminals.get(id);
      if (!terminal) return;

      // Check if the tmux session still exists
      const sessionAlive = await tmuxHasSession(tmuxName);
      if (!sessionAlive) {
        // Session was destroyed (shell exited) — notify clients
        terminal.exited = true;
        for (const socket of terminal.sockets) {
          socket.emit('session-exit', { exitCode: 0 });
        }
      }
      // If session is still alive, the pty exited for another reason (e.g. detach).
      // This shouldn't happen in normal operation since we control the attachment.
    });

    const meta = {
      id,
      projectSlug,
      label: label || 'Terminal',
      createdAt,
      tmuxSessionName: tmuxName,
    };

    await writeFile(
      join(this.terminalsDir, `${id}.json`),
      JSON.stringify(meta, null, 2) + '\n'
    );

    this.terminals.set(id, {
      ...meta,
      pty: ptyProcess,
      ringBuffer,
      sockets: new Set(),
      exited: false,
    });

    return this._publicMeta(meta);
  }

  /**
   * Reconcile tmux sessions with terminal metadata on server startup.
   * - Reattaches to orphaned tmux sessions (metadata exists, tmux session alive)
   * - Cleans up stale metadata (metadata exists, tmux session gone)
   * - Logs warnings for stale entries
   */
  async reconcile() {
    if (!existsSync(this.terminalsDir)) {
      return { reattached: 0, cleaned: 0 };
    }

    const files = await readdir(this.terminalsDir);
    const metaFiles = files.filter((f) => f.endsWith('.json'));

    let reattached = 0;
    let cleaned = 0;

    for (const file of metaFiles) {
      const metaPath = join(this.terminalsDir, file);
      let meta;
      try {
        meta = JSON.parse(await readFile(metaPath, 'utf-8'));
      } catch {
        console.warn(`[reconcile] Could not parse metadata file: ${file}`);
        continue;
      }

      const tmuxName = meta.tmuxSessionName;
      if (!tmuxName) {
        console.warn(`[reconcile] Metadata missing tmuxSessionName: ${file}`);
        await rm(metaPath);
        cleaned++;
        continue;
      }

      const sessionAlive = await tmuxHasSession(tmuxName);

      if (sessionAlive) {
        // Reattach: spawn node-pty to connect to the existing tmux session
        const ptyProcess = pty.spawn('tmux', ['attach-session', '-t', tmuxName], {
          name: 'xterm-256color',
          cols: 80,
          rows: 24,
          env: process.env,
        });

        // Populate ring buffer from tmux scrollback
        const ringBuffer = new RingBuffer();
        const scrollback = await tmuxCapturePane(tmuxName);
        if (scrollback) {
          ringBuffer.append(scrollback);
        }

        ptyProcess.onData((data) => {
          ringBuffer.append(data);
          const terminal = this.terminals.get(meta.id);
          if (terminal) {
            for (const socket of terminal.sockets) {
              socket.emit('output', data);
            }
          }
        });

        ptyProcess.onExit(async () => {
          const terminal = this.terminals.get(meta.id);
          if (!terminal) return;

          const alive = await tmuxHasSession(tmuxName);
          if (!alive) {
            terminal.exited = true;
            for (const socket of terminal.sockets) {
              socket.emit('session-exit', { exitCode: 0 });
            }
          }
        });

        this.terminals.set(meta.id, {
          ...meta,
          pty: ptyProcess,
          ringBuffer,
          sockets: new Set(),
          exited: false,
        });

        reattached++;
        console.log(`[reconcile] Reattached terminal ${meta.id} → tmux session ${tmuxName}`);
      } else {
        // Stale metadata: tmux session is gone
        console.warn(`[reconcile] Stale metadata for terminal ${meta.id}: tmux session ${tmuxName} not found. Cleaning up.`);
        await rm(metaPath);
        cleaned++;
      }
    }

    return { reattached, cleaned };
  }

  /**
   * Get the tmux session name for a terminal (used by tests).
   */
  getTmuxSessionName(id) {
    const terminal = this.terminals.get(id);
    return terminal?.tmuxSessionName || null;
  }

  /**
   * Return public metadata (no tmux internals).
   */
  _publicMeta(meta) {
    return {
      id: meta.id,
      projectSlug: meta.projectSlug,
      label: meta.label,
      createdAt: meta.createdAt,
    };
  }

  /**
   * Get terminal metadata by ID. Returns null if not found.
   * Does NOT include tmux session name (invisible to clients).
   */
  get(id) {
    const terminal = this.terminals.get(id);
    if (!terminal) return null;
    return this._publicMeta(terminal);
  }

  /**
   * List terminals, optionally filtered by project slug.
   * Does NOT include tmux session name (invisible to clients).
   */
  list(projectSlug) {
    const results = [];
    for (const terminal of this.terminals.values()) {
      if (!projectSlug || terminal.projectSlug === projectSlug) {
        results.push(this._publicMeta(terminal));
      }
    }
    return results;
  }

  /**
   * Update terminal metadata (e.g. label).
   */
  async update(id, updates) {
    const terminal = this.terminals.get(id);
    if (!terminal) return null;

    if (updates.label !== undefined) {
      terminal.label = updates.label;
    }

    const meta = {
      id: terminal.id,
      projectSlug: terminal.projectSlug,
      label: terminal.label,
      createdAt: terminal.createdAt,
      tmuxSessionName: terminal.tmuxSessionName,
    };

    await writeFile(
      join(this.terminalsDir, `${id}.json`),
      JSON.stringify(meta, null, 2) + '\n'
    );

    return this._publicMeta(meta);
  }

  /**
   * Destroy a terminal: kill PTY, kill tmux session, disconnect sockets, remove metadata file.
   */
  async destroy(id) {
    const terminal = this.terminals.get(id);
    if (!terminal) return false;

    try {
      terminal.pty.kill();
    } catch {
      // already dead
    }

    // Kill the tmux session
    if (terminal.tmuxSessionName) {
      await tmuxKillSession(terminal.tmuxSessionName);
    }

    for (const socket of terminal.sockets) {
      socket.disconnect(true);
    }

    const metaPath = join(this.terminalsDir, `${id}.json`);
    if (existsSync(metaPath)) {
      await rm(metaPath);
    }

    this.terminals.delete(id);
    return true;
  }

  /**
   * Attach a WebSocket to a terminal. Replays ring buffer on connect.
   */
  attach(id, socket) {
    const terminal = this.terminals.get(id);
    if (!terminal) return false;

    terminal.sockets.add(socket);

    const buffered = terminal.ringBuffer.getContents();
    if (buffered) {
      socket.emit('output', buffered);
    }

    return true;
  }

  /**
   * Detach a WebSocket from a terminal.
   */
  detach(id, socket) {
    const terminal = this.terminals.get(id);
    if (!terminal) return;
    terminal.sockets.delete(socket);
  }

  /**
   * Write data to a terminal's PTY stdin.
   */
  write(id, data) {
    const terminal = this.terminals.get(id);
    if (!terminal) return false;
    terminal.pty.write(data);
    return true;
  }

  /**
   * Resize a terminal's PTY and tmux pane.
   */
  resize(id, cols, rows) {
    const terminal = this.terminals.get(id);
    if (!terminal) return false;
    try {
      terminal.pty.resize(cols, rows);
    } catch {
      // pty already exited
    }
    // Also resize the tmux pane so the shell sees the correct dimensions
    if (terminal.tmuxSessionName) {
      tmuxResizePane(terminal.tmuxSessionName, cols, rows).catch(() => {});
    }
    return true;
  }

  /**
   * Destroy all managed terminals. Used for cleanup on shutdown.
   */
  async destroyAll() {
    const ids = [...this.terminals.keys()];
    for (const id of ids) {
      await this.destroy(id);
    }
  }
}

/**
 * Set up Socket.io dynamic namespace for per-terminal WebSocket connections.
 * Matches paths like /terminal/{uuid-v4}.
 */
export function setupTerminalManagerNamespace(io, manager) {
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

    const attached = manager.attach(terminalId, socket);
    if (!attached) {
      socket.emit('error', { message: 'Terminal not found' });
      socket.disconnect(true);
      return;
    }

    socket.on('input', (data) => {
      manager.write(terminalId, data);
    });

    socket.on('resize', (payload) => {
      if (payload == null || typeof payload !== 'object') return;
      const { cols, rows } = payload;
      if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 1 || rows < 1) return;
      manager.resize(terminalId, cols, rows);
    });

    socket.on('disconnect', () => {
      manager.detach(terminalId, socket);
    });
  });

  return ns;
}
