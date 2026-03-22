import pty from 'node-pty';
import { validateToken } from './auth.js';

/**
 * Set up the Socket.io /terminal namespace.
 * Each connecting client gets a node-pty process attached to
 * `tmux attach -t <session>`.
 *
 * @param {import('socket.io').Server} io - Socket.io server instance
 * @param {string} sessionName - tmux session to attach to
 * @param {string} authToken - expected auth token
 * @returns {import('socket.io').Namespace} the /terminal namespace
 */
export function setupTerminalNamespace(io, sessionName, authToken) {
  const ns = io.of('/terminal');

  ns.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!authToken || !validateToken(token, authToken)) {
      return next(new Error('Authentication failed'));
    }
    next();
  });

  ns.on('connection', (socket) => {
    const cols = socket.handshake.query.cols
      ? parseInt(socket.handshake.query.cols, 10)
      : 80;
    const rows = socket.handshake.query.rows
      ? parseInt(socket.handshake.query.rows, 10)
      : 24;

    const ptyProcess = pty.spawn('tmux', ['attach', '-t', sessionName], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: process.env.HOME,
      env: process.env,
    });

    ptyProcess.onData((data) => {
      socket.emit('output', data);
    });

    socket.on('input', (data) => {
      ptyProcess.write(data);
    });

    socket.on('resize', (payload) => {
      if (payload == null || typeof payload !== 'object') return;
      const { cols, rows } = payload;
      try {
        ptyProcess.resize(cols, rows);
      } catch {
        // pty already exited
      }
    });

    socket.on('disconnect', () => {
      try {
        ptyProcess.kill();
      } catch {
        // already dead
      }
    });

    ptyProcess.onExit(() => {
      socket.disconnect(true);
    });
  });

  return ns;
}
