import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ensureSession, createProjectSession, sessionExists, listSessions } from './tmux.js';
import { setupTerminalNamespace } from './terminal.js';
import { ensureAuthToken, validateToken } from './auth.js';
import { validateProjectInput, createProject, listProjects, getProject, updateProject, deleteProject, getProjectsDir, slugify, isValidSlug } from './projects.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = process.env.PORT || 3000;

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { transports: ['websocket'] });

let authToken = null;
let projectsDir = null;

app.use(express.json());

/**
 * Express middleware that requires a valid Bearer token on API routes.
 * Skips /api/auth/validate (the login endpoint).
 */
function requireAuth(req, res, next) {
  // Skip the login/validate endpoint
  if (req.path === '/auth/validate') {
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid authorization header' });
  }

  const token = authHeader.slice(7);
  if (!authToken || !validateToken(token, authToken)) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  next();
}

app.use('/api', requireAuth);

const placeholderHTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DanCode</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background-color: #002b36;
      color: #839496;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
    }
    .container {
      text-align: center;
    }
    h1 {
      color: #93a1a1;
      font-size: 3rem;
      font-weight: 300;
      letter-spacing: 0.1em;
      margin-bottom: 0.5rem;
    }
    p {
      color: #586e75;
      font-size: 1rem;
    }
  </style>
</head>
<body data-theme="dark">
  <div class="container">
    <h1>DanCode</h1>
    <p>Web-Based Project Terminal Manager</p>
  </div>
</body>
</html>`;

app.get('/', (req, res) => {
  res.type('html').send(placeholderHTML);
});

app.post('/api/auth/validate', (req, res) => {
  const { token } = req.body || {};
  if (!authToken || !validateToken(token, authToken)) {
    return res.status(401).json({ error: 'Invalid token' });
  }
  res.json({ valid: true });
});

app.get('/api/projects', async (req, res) => {
  try {
    const projects = await listProjects(projectsDir);
    res.json(projects);
  } catch (err) {
    res.status(500).json({ error: 'Failed to list projects' });
  }
});

app.get('/api/tmux-status', async (req, res) => {
  try {
    const projects = await listProjects(projectsDir);
    const status = {};
    await Promise.all(
      projects.map(async (p) => {
        status[p.slug] = await sessionExists(`dancode-${p.slug}`);
      })
    );
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: 'Failed to check tmux status' });
  }
});

app.get('/api/tmux/sessions', async (req, res) => {
  try {
    const [allSessions, projects] = await Promise.all([
      listSessions(),
      listProjects(projectsDir),
    ]);

    // Build set of session names that are already mapped to a project
    const mappedSessions = new Set(projects.map((p) => `dancode-${p.slug}`));

    // Filter out mapped sessions and internal connection sessions
    const orphaned = allSessions.filter(
      (name) => !mappedSessions.has(name) && !name.includes('-conn-')
    );

    res.json(orphaned.map((name) => ({ name })));
  } catch (err) {
    res.status(500).json({ error: 'Failed to list tmux sessions' });
  }
});

app.get('/api/projects/:slug', async (req, res) => {
  const { slug } = req.params;
  if (!isValidSlug(slug)) {
    return res.status(400).json({ error: 'Invalid project slug' });
  }
  try {
    const project = await getProject(slug, projectsDir);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    res.json(project);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get project' });
  }
});

app.patch('/api/projects/:slug', async (req, res) => {
  const { slug } = req.params;
  if (!isValidSlug(slug)) {
    return res.status(400).json({ error: 'Invalid project slug' });
  }
  const { layout } = req.body || {};
  if (!layout || typeof layout !== 'object') {
    return res.status(400).json({ error: 'Request body must include a layout object' });
  }
  try {
    const updated = await updateProject(slug, { layout }, projectsDir);
    if (!updated) {
      return res.status(404).json({ error: 'Project not found' });
    }
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update project' });
  }
});

app.delete('/api/projects/:slug', async (req, res) => {
  const { slug } = req.params;
  if (!isValidSlug(slug)) {
    return res.status(400).json({ error: 'Invalid project slug' });
  }
  try {
    const deleted = await deleteProject(slug, projectsDir);
    if (!deleted) {
      return res.status(404).json({ error: 'Project not found' });
    }
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete project' });
  }
});

app.post('/api/projects', async (req, res) => {
  const { name, path } = req.body || {};

  const validation = validateProjectInput(name, path);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.error });
  }

  // Reject slugs that would collide with the server's bootstrap tmux session
  const slug = slugify(name.trim());
  if (`dancode-${slug}` === TMUX_SESSION) {
    return res.status(400).json({ error: `Project name conflicts with a reserved session name` });
  }

  try {
    const project = await createProject(name, path, projectsDir);

    // Spin up the tmux session with CLI + Claude panes
    try {
      await createProjectSession(project.slug, project.path);
    } catch (tmuxErr) {
      // Roll back: remove the persisted project config
      await deleteProject(project.slug, projectsDir);
      return res.status(500).json({ error: `Failed to create tmux session: ${tmuxErr.message}` });
    }

    res.status(201).json(project);
  } catch (err) {
    if (err.message.includes('already exists')) {
      return res.status(409).json({ error: err.message });
    }
    res.status(500).json({ error: 'Failed to create project' });
  }
});

io.on('connection', (socket) => {
  socket.on('disconnect', () => {});
});

export { app, httpServer, io };

const TMUX_SESSION = process.env.DANCODE_TMUX_SESSION || 'dancode-test';

let terminalNamespaceRegistered = false;

export async function startServer(port = PORT, { tokenPath, projectsDir: projDir } = {}) {
  const { token } = await ensureAuthToken(tokenPath);
  authToken = token;
  projectsDir = projDir || getProjectsDir();

  try {
    await ensureSession(TMUX_SESSION);
  } catch (err) {
    throw new Error(`Failed to ensure tmux session "${TMUX_SESSION}": ${err.message}`);
  }

  if (!terminalNamespaceRegistered) {
    setupTerminalNamespace(io, TMUX_SESSION, () => authToken);
    terminalNamespaceRegistered = true;
  }

  return new Promise((resolve) => {
    httpServer.listen(port, () => {
      console.log(`DanCode server listening on http://localhost:${port}`);
      resolve(httpServer);
    });
  });
}

// Start the server when run directly (not imported for tests)
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startServer();
}
