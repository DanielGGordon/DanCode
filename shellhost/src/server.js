import { createServer } from 'node:net';
import { existsSync } from 'node:fs';
import { mkdir, unlink, chmod, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { PTYManager } from './pty-manager.js';
import { encodeFrame, FrameDecoder, makeResponse, makeEvent } from './wire.js';

/**
 * Build a shellhost UNIX-socket server backed by a PTYManager.
 * Returns { listen, close, manager, server }.
 *
 * @param {object} [opts]
 * @param {PTYManager} [opts.manager] - inject a pre-built manager (tests).
 */
export function createShellhost({ manager } = {}) {
  const ptyManager = manager || new PTYManager();
  const connections = new Set();

  const server = createServer((socket) => {
    const decoder = new FrameDecoder();

    // Per-connection state: which terminals this connection is attached to,
    // mapped to their detach functions.
    const attachments = new Map(); // terminalId -> detach fn

    const send = (frame) => {
      if (socket.destroyed || !socket.writable) return;
      try {
        socket.write(encodeFrame(frame));
      } catch { /* socket may have closed mid-write */ }
    };

    decoder.onFrame = (frame) => {
      handleFrame(frame, { send, attachments, ptyManager })
        .catch((err) => {
          if (frame?.requestId) {
            send(makeResponse(frame.requestId, false, err));
          }
        });
    };

    decoder.onError = (err) => {
      console.error('[shellhost] frame decode error:', err.message);
    };

    socket.on('data', (chunk) => decoder.push(chunk));

    socket.on('error', () => { /* swallow — close handler does cleanup */ });

    socket.on('close', () => {
      // CRUCIAL: detaching does NOT kill PTYs. The PTYs survive until an
      // explicit `kill` op.
      for (const [, detach] of attachments) {
        try { detach(); } catch { /* ignore */ }
      }
      attachments.clear();
      connections.delete(socket);
    });

    connections.add(socket);
  });

  /**
   * Start listening on a UNIX socket path. Removes a stale socket file if
   * one exists from a previous crash.
   */
  async function listen(socketPath) {
    if (!socketPath || typeof socketPath !== 'string') {
      throw new TypeError('listen: socketPath is required');
    }
    const dir = dirname(socketPath);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
    if (existsSync(socketPath)) {
      try {
        const st = await stat(socketPath);
        if (st.isSocket()) {
          await unlink(socketPath);
        } else {
          throw new Error(`refusing to overwrite non-socket file at ${socketPath}`);
        }
      } catch (err) {
        if (err.code !== 'ENOENT') throw err;
      }
    }
    await new Promise((resolve, reject) => {
      const onError = (err) => reject(err);
      server.once('error', onError);
      server.listen(socketPath, () => {
        server.off('error', onError);
        resolve();
      });
    });
    try { await chmod(socketPath, 0o600); } catch { /* best-effort */ }
    return socketPath;
  }

  function close() {
    return new Promise((resolve) => {
      for (const sock of connections) {
        try { sock.destroy(); } catch { /* ignore */ }
      }
      connections.clear();
      ptyManager.killAll();
      server.close(() => resolve());
    });
  }

  return { listen, close, manager: ptyManager, server, _connections: connections };
}

/**
 * Dispatch a single inbound frame. Exported for unit tests.
 */
export async function handleFrame(frame, { send, attachments, ptyManager }) {
  if (frame?.type !== 'req' || !frame.op) return;
  const { requestId, op, payload = {} } = frame;

  try {
    const result = await dispatchOp(op, payload, { send, attachments, ptyManager });
    send(makeResponse(requestId, true, result));
  } catch (err) {
    send(makeResponse(requestId, false, err));
  }
}

async function dispatchOp(op, payload, ctx) {
  const { send, attachments, ptyManager } = ctx;

  switch (op) {
    case 'spawn': {
      const { projectSlug, cwd, command, cols, rows, background } = payload;
      const meta = ptyManager.spawn({ projectSlug, cwd, command, cols, rows, background });
      return { terminalId: meta.id, terminal: meta };
    }

    case 'attach': {
      const { terminalId } = payload;
      if (!terminalId) throw new Error('attach: terminalId required');
      if (attachments.has(terminalId)) {
        // Already attached on this connection — idempotent. No replay.
        const existing = ptyManager.inspect(terminalId);
        if (!existing) throw new Error(`attach: terminal ${terminalId} not found`);
        return { ok: true, terminal: existing };
      }
      // Replay scrollback tail BEFORE registering the live listener so the
      // attacher sees history then live output in order.
      const replay = ptyManager.getScrollback(terminalId);
      if (replay) {
        send(makeEvent(terminalId, 'output', { data: replay }));
      }
      const onOutput = (data) => {
        send(makeEvent(terminalId, 'output', { data }));
      };
      const onExit = ({ exitCode, signal }) => {
        send(makeEvent(terminalId, 'exit', { exitCode, signal }));
      };
      const detach = ptyManager.attach(terminalId, { onOutput, onExit });
      if (!detach) throw new Error(`attach: terminal ${terminalId} not found`);
      attachments.set(terminalId, detach);
      const meta = ptyManager.inspect(terminalId);
      return { ok: true, terminal: meta };
    }

    case 'detach': {
      const { terminalId } = payload;
      if (!terminalId) throw new Error('detach: terminalId required');
      const detach = attachments.get(terminalId);
      if (detach) {
        try { detach(); } catch { /* ignore */ }
        attachments.delete(terminalId);
      }
      return { ok: true };
    }

    case 'write': {
      const { terminalId, data } = payload;
      if (!terminalId) throw new Error('write: terminalId required');
      if (typeof data !== 'string') throw new Error('write: data must be a string');
      const ok = ptyManager.write(terminalId, data);
      return { ok };
    }

    case 'resize': {
      const { terminalId, cols, rows } = payload;
      if (!terminalId) throw new Error('resize: terminalId required');
      const ok = ptyManager.resize(terminalId, cols, rows);
      return { ok };
    }

    case 'kill': {
      const { terminalId } = payload;
      if (!terminalId) throw new Error('kill: terminalId required');
      // Auto-detach listeners on this connection.
      const detach = attachments.get(terminalId);
      if (detach) {
        try { detach(); } catch { /* ignore */ }
        attachments.delete(terminalId);
      }
      const ok = ptyManager.kill(terminalId);
      return { ok };
    }

    case 'list': {
      const { projectSlug } = payload;
      const terminals = ptyManager.list(projectSlug ? { projectSlug } : {});
      return { terminals };
    }

    case 'inspect': {
      const { terminalId } = payload;
      if (!terminalId) throw new Error('inspect: terminalId required');
      const terminal = ptyManager.inspect(terminalId);
      if (!terminal) throw new Error(`inspect: terminal ${terminalId} not found`);
      return { terminal };
    }

    case 'getScrollback': {
      const { terminalId } = payload;
      if (!terminalId) throw new Error('getScrollback: terminalId required');
      const data = ptyManager.getScrollback(terminalId);
      return { data };
    }

    case 'respawn': {
      const { terminalId } = payload;
      if (!terminalId) throw new Error('respawn: terminalId required');
      const meta = ptyManager.respawn(terminalId);
      return { ok: true, terminal: meta };
    }

    case 'setBackground': {
      const { terminalId, background } = payload;
      if (!terminalId) throw new Error('setBackground: terminalId required');
      const meta = ptyManager.setBackground(terminalId, !!background);
      if (!meta) throw new Error(`setBackground: terminal ${terminalId} not found`);
      return { ok: true, terminal: meta };
    }

    default:
      throw new Error(`unknown op: ${op}`);
  }
}
