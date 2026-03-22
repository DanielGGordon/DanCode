import pty from 'node-pty';
import { validateToken } from './auth.js';
import { isValidSlug } from './projects.js';

/**
 * Set up the Socket.io /terminal namespace.
 * Each connecting client gets a node-pty process attached to
 * `tmux attach -t <session>`.
 *
 * Clients may pass a `slug` query parameter to connect to a project-specific
 * tmux session (`dancode-<slug>`) instead of the default bootstrap session.
 *
 * @param {import('socket.io').Server} io - Socket.io server instance
 * @param {string} defaultSession - default tmux session to attach to
 * @param {() => string} getAuthToken - function returning the current auth token
 * @returns {import('socket.io').Namespace} the /terminal namespace
 */
export function setupTerminalNamespace(io, defaultSession, getAuthToken) {
  const ns = io.of('/terminal');

  ns.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    const authToken = getAuthToken();
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

    const slug = socket.handshake.query.slug;
    const sessionName = (slug && isValidSlug(slug))
      ? `dancode-${slug}`
      : defaultSession;

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
