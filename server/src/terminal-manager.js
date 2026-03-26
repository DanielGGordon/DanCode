import pty from 'node-pty';
import { randomUUID } from 'node:crypto';
import { writeFile, rm, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { validateSession } from './auth.js';

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
 * Manages PTY terminal processes with metadata persistence.
 * Each terminal has an in-memory ring buffer (~50KB) for output replay
 * and supports multiple concurrent WebSocket connections.
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
   * Create a new terminal with a PTY process.
   */
  async create({ projectSlug, label, command, cols = 80, rows = 24, cwd }) {
    const id = randomUUID();
    const createdAt = new Date().toISOString();

    if (!existsSync(this.terminalsDir)) {
      await mkdir(this.terminalsDir, { recursive: true });
    }

    const shell = process.env.SHELL || '/bin/bash';
    const ptyProcess = pty.spawn(shell, [], {
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

    ptyProcess.onExit(({ exitCode }) => {
      const terminal = this.terminals.get(id);
      if (terminal) {
        terminal.exited = true;
        for (const socket of terminal.sockets) {
          socket.emit('session-exit', { exitCode });
        }
      }
    });

    const meta = { id, projectSlug, label: label || 'Terminal', createdAt };

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

    if (command) {
      ptyProcess.write(command + '\n');
    }

    return meta;
  }

  /**
   * Get terminal metadata by ID. Returns null if not found.
   */
  get(id) {
    const terminal = this.terminals.get(id);
    if (!terminal) return null;
    return { id: terminal.id, projectSlug: terminal.projectSlug, label: terminal.label, createdAt: terminal.createdAt };
  }

  /**
   * List terminals, optionally filtered by project slug.
   */
  list(projectSlug) {
    const results = [];
    for (const terminal of this.terminals.values()) {
      if (!projectSlug || terminal.projectSlug === projectSlug) {
        results.push({
          id: terminal.id,
          projectSlug: terminal.projectSlug,
          label: terminal.label,
          createdAt: terminal.createdAt,
        });
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
    };

    await writeFile(
      join(this.terminalsDir, `${id}.json`),
      JSON.stringify(meta, null, 2) + '\n'
    );

    return meta;
  }

  /**
   * Destroy a terminal: kill PTY, disconnect sockets, remove metadata file.
   */
  async destroy(id) {
    const terminal = this.terminals.get(id);
    if (!terminal) return false;

    try {
      terminal.pty.kill();
    } catch {
      // already dead
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
   * Resize a terminal's PTY.
   */
  resize(id, cols, rows) {
    const terminal = this.terminals.get(id);
    if (!terminal) return false;
    try {
      terminal.pty.resize(cols, rows);
    } catch {
      // pty already exited
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
