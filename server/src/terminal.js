import pty from 'node-pty';
import { randomBytes } from 'node:crypto';
import { validateToken } from './auth.js';
import { isValidSlug } from './projects.js';
import { createConnectionSession, destroyConnectionSession, breakPanesIntoWindows, joinWindowsIntoPanes } from './tmux.js';

// Track active connections per base session for break/rejoin lifecycle
const sessionConnections = new Map();

function trackConnect(baseSession) {
  sessionConnections.set(baseSession, (sessionConnections.get(baseSession) || 0) + 1);
}

async function trackDisconnect(baseSession) {
  const count = (sessionConnections.get(baseSession) || 1) - 1;
  if (count <= 0) {
    sessionConnections.delete(baseSession);
    // Last connection gone — rejoin windows back into panes
    try {
      await joinWindowsIntoPanes(baseSession);
    } catch {
      // Non-fatal
    }
  } else {
    sessionConnections.set(baseSession, count);
  }
}

/**
 * Set up the Socket.io /terminal namespace.
 * Each connecting client gets a node-pty process attached to
 * `tmux attach -t <session>`.
 *
 * Clients may pass a `slug` query parameter to connect to a project-specific
 * tmux session (`dancode-<slug>`) instead of the default bootstrap session.
 *
 * When a `pane` query parameter is provided (0-based window index), a grouped
 * tmux session is created so this connection sees only that window.
 *
 * @param {import('socket.io').Server} io - Socket.io server instance
 * @param {string} defaultSession - default tmux session to attach to
 * @param {() => string} getAuthToken - function returning the current auth token
 * @param {(slug: string) => Promise<string>} [resolveSession] - optional async function
 *   that resolves a project slug to its tmux session name (supports adopted sessions)
 * @returns {import('socket.io').Namespace} the /terminal namespace
 */
export function setupTerminalNamespace(io, defaultSession, getAuthToken, resolveSession) {
  const ns = io.of('/terminal');

  ns.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    const authToken = getAuthToken();
    if (!authToken || !validateToken(token, authToken)) {
      return next(new Error('Authentication failed'));
    }
    next();
  });

  ns.on('connection', async (socket) => {
    const cols = socket.handshake.query.cols
      ? parseInt(socket.handshake.query.cols, 10)
      : 80;
    const rows = socket.handshake.query.rows
      ? parseInt(socket.handshake.query.rows, 10)
      : 24;

    const slug = socket.handshake.query.slug;
    const pane = socket.handshake.query.pane;
    let baseSession = defaultSession;
    if (slug && isValidSlug(slug)) {
      if (resolveSession) {
        try {
          baseSession = await resolveSession(slug);
        } catch {
          baseSession = `dancode-${slug}`;
        }
      } else {
        baseSession = `dancode-${slug}`;
      }
    }

    // Break panes into windows on first connection to this session
    if (!sessionConnections.has(baseSession)) {
      try {
        await breakPanesIntoWindows(baseSession);
      } catch {
        // Non-fatal
      }
    }
    trackConnect(baseSession);

    // When a specific pane is requested, create a grouped session
    // so this connection sees only that window.
    let attachSession = baseSession;
    let connSession = null;

    if (pane != null && pane !== '') {
      const windowIndex = parseInt(pane, 10);
      if (!Number.isNaN(windowIndex) && windowIndex >= 0) {
        const connId = randomBytes(4).toString('hex');
        try {
          connSession = await createConnectionSession(baseSession, windowIndex, connId);
          attachSession = connSession;
        } catch {
          // If grouped session creation fails, fall back to base session
        }
      }
    }

    const ptyProcess = pty.spawn('tmux', ['attach', '-t', attachSession], {
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
      if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 1 || rows < 1) return;
      try {
        ptyProcess.resize(cols, rows);
      } catch {
        // pty already exited
      }
    });

    let disconnected = false;
    const cleanup = () => {
      if (disconnected) return;
      disconnected = true;
      try {
        ptyProcess.kill();
      } catch {
        // already dead
      }
      if (connSession) {
        destroyConnectionSession(connSession);
      }
      trackDisconnect(baseSession);
    };

    socket.on('disconnect', cleanup);

    ptyProcess.onExit(({ exitCode }) => {
      // Notify client that the tmux session ended before disconnecting
      socket.emit('session-exit', { exitCode });
      cleanup();
      socket.disconnect(true);
    });
  });

  return ns;
}
