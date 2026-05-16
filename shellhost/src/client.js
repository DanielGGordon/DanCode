import { connect as netConnect } from 'node:net';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { encodeFrame, FrameDecoder } from './wire.js';

/**
 * Client library for talking to a running shellhost over a UNIX socket.
 *
 * Usage:
 *   const client = createShellhostClient({ socketPath: '/tmp/foo.sock' });
 *   await client.connect();
 *   const { terminalId } = await client.spawn({ projectSlug: 'demo' });
 *   client.on(`output:${terminalId}`, (data) => ...);
 *   await client.attach(terminalId);
 *   await client.write(terminalId, 'echo hi\r');
 *   await client.kill(terminalId);
 *   client.close();
 */
export function createShellhostClient({ socketPath, reconnect = false } = {}) {
  if (!socketPath || typeof socketPath !== 'string') {
    throw new TypeError('createShellhostClient: socketPath is required');
  }

  const emitter = new EventEmitter();
  emitter.setMaxListeners(0);

  /** @type {import('node:net').Socket | null} */
  let socket = null;
  const decoder = new FrameDecoder();
  const pending = new Map(); // requestId -> { resolve, reject }
  let connected = false;
  let closed = false;

  decoder.onFrame = (frame) => {
    if (frame.type === 'res') {
      const slot = pending.get(frame.requestId);
      if (!slot) return;
      pending.delete(frame.requestId);
      const { ok, result, error } = frame.payload || {};
      if (ok) slot.resolve(result);
      else slot.reject(new Error(error || 'shellhost error'));
      return;
    }
    if (frame.type === 'event') {
      const { terminalId, op, payload } = frame;
      // Generic and per-terminal events.
      emitter.emit('event', frame);
      emitter.emit(op, terminalId, payload);
      emitter.emit(`${op}:${terminalId}`, payload);
    }
  };

  decoder.onError = (err) => {
    emitter.emit('protocol-error', err);
  };

  function connect() {
    if (connected) return Promise.resolve();
    if (closed) return Promise.reject(new Error('client is closed'));

    return new Promise((resolve, reject) => {
      const s = netConnect(socketPath);
      s.once('connect', () => {
        socket = s;
        connected = true;
        emitter.emit('connect');
        resolve();
      });
      s.once('error', (err) => {
        if (!connected) reject(err);
      });
      s.on('data', (chunk) => decoder.push(chunk));
      s.on('close', () => {
        connected = false;
        socket = null;
        // Reject any outstanding requests.
        for (const [, slot] of pending) {
          slot.reject(new Error('shellhost connection closed'));
        }
        pending.clear();
        emitter.emit('close');
      });
      s.on('error', (err) => {
        emitter.emit('error', err);
      });
    });
  }

  async function request(op, payload = {}) {
    if (closed) throw new Error('client is closed');
    if (!connected) await connect();
    const requestId = randomUUID();
    const frame = { type: 'req', requestId, op, payload };
    return new Promise((resolve, reject) => {
      pending.set(requestId, { resolve, reject });
      try {
        socket.write(encodeFrame(frame));
      } catch (err) {
        pending.delete(requestId);
        reject(err);
      }
    });
  }

  function close() {
    closed = true;
    if (socket) {
      try { socket.end(); } catch { /* ignore */ }
      try { socket.destroy(); } catch { /* ignore */ }
    }
    socket = null;
    connected = false;
  }

  const api = {
    on: emitter.on.bind(emitter),
    off: emitter.off.bind(emitter),
    once: emitter.once.bind(emitter),
    addListener: emitter.addListener.bind(emitter),
    removeListener: emitter.removeListener.bind(emitter),
    emit: emitter.emit.bind(emitter),
    setMaxListeners: emitter.setMaxListeners.bind(emitter),

    connect,
    close,
    get connected() { return connected; },

    spawn(payload) { return request('spawn', payload); },
    attach(terminalId) { return request('attach', { terminalId }); },
    detach(terminalId) { return request('detach', { terminalId }); },
    write(terminalId, data) { return request('write', { terminalId, data }); },
    resize(terminalId, cols, rows) { return request('resize', { terminalId, cols, rows }); },
    kill(terminalId) { return request('kill', { terminalId }); },
    list(filter = {}) { return request('list', filter); },
    inspect(terminalId) { return request('inspect', { terminalId }); },
    getScrollback(terminalId) { return request('getScrollback', { terminalId }); },
    respawn(terminalId) { return request('respawn', { terminalId }); },

    // Escape hatch for op-extensions (background mode, claude session, etc.) in
    // future phases.
    request,
  };

  return api;
}
