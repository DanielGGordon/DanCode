import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { isAccountSetUp, createAccount, verifyLogin, createSession, validateSession, destroySession, getCredentialsPath } from './auth.js';
import { validateProjectInput, createProject, listProjects, getProject, updateProject, deleteProject, getProjectsDir, slugify, isValidSlug } from './projects.js';
import { TerminalManager, setupTerminalManagerNamespace, getTerminalsDir } from './terminal-manager.js';
import { listDirectory, readFileContent, writeFileContent, createDirectory, renameFile, deleteFile, safePath } from './files.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = process.env.PORT || 3000;

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { transports: ['websocket'] });

let projectsDir = null;
let credentialsPath = null;
export let terminalManager = null;

app.use(express.json({ limit: '20mb' }));

/**
 * Express middleware that requires a valid session token on API routes.
 * Skips auth setup and login endpoints.
 */
function requireAuth(req, res, next) {
  // Skip auth endpoints that don't need a session
  if (req.path === '/auth/login' || req.path === '/auth/setup' || req.path === '/auth/setup/status' || req.path === '/auth/validate') {
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid authorization header' });
  }

  const token = authHeader.slice(7);
  if (!validateSession(token)) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  next();
}

app.use('/api', requireAuth);

// Serve the compiled React client from client/dist/ in production
const clientDistPath = join(__dirname, '..', '..', 'client', 'dist');
const hasClientBuild = existsSync(join(clientDistPath, 'index.html'));

if (hasClientBuild) {
  app.use(express.static(clientDistPath));
}

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

app.get('/api/auth/setup/status', async (req, res) => {
  const ready = await isAccountSetUp(credentialsPath);
  res.json({ setupComplete: ready });
});

app.post('/api/auth/setup', async (req, res) => {
  // Only allow setup if no account exists yet
  if (await isAccountSetUp(credentialsPath)) {
    return res.status(409).json({ error: 'Account already exists' });
  }

  const { username, password } = req.body || {};
  if (!username || typeof username !== 'string' || !username.trim()) {
    return res.status(400).json({ error: 'Username is required' });
  }
  if (!password || typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  try {
    const { totpSecret, qrCodeDataUrl } = await createAccount(username.trim(), password, credentialsPath);
    res.json({ totpSecret, qrCodeDataUrl });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create account' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password, totpCode } = req.body || {};
  if (!username || !password || !totpCode) {
    return res.status(400).json({ error: 'Username, password, and TOTP code are required' });
  }

  const valid = await verifyLogin(username, password, totpCode, credentialsPath);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const sessionToken = createSession(username);
  res.json({ token: sessionToken });
});

app.post('/api/auth/logout', (req, res) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    destroySession(authHeader.slice(7));
  }
  res.json({ ok: true });
});

app.post('/api/auth/validate', (req, res) => {
  const { token } = req.body || {};
  if (!validateSession(token)) {
    return res.status(401).json({ error: 'Invalid session' });
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

app.post('/api/projects/:slug/upload', async (req, res) => {
  const { slug } = req.params;
  if (!isValidSlug(slug)) {
    return res.status(400).json({ error: 'Invalid project slug' });
  }
  const { data, filename } = req.body || {};
  if (!data || typeof data !== 'string') {
    return res.status(400).json({ error: 'Missing image data' });
  }

  try {
    const project = await getProject(slug, projectsDir);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Save to project path if available, otherwise ~/.dancode/uploads/<slug>/
    const uploadDir = project.path
      ? join(project.path, '.dancode-uploads')
      : join(process.env.HOME, '.dancode', 'uploads', slug);

    if (!existsSync(uploadDir)) {
      mkdirSync(uploadDir, { recursive: true });
    }

    // Generate timestamped filename
    const ext = filename?.match(/\.\w+$/)?.[0] || '.png';
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const safeName = `upload-${ts}${ext}`;
    const filePath = join(uploadDir, safeName);

    // Strip data URL prefix if present (e.g. "data:image/png;base64,")
    const base64Data = data.replace(/^data:[^;]+;base64,/, '');
    await writeFile(filePath, Buffer.from(base64Data, 'base64'));

    res.json({ path: filePath });
  } catch (err) {
    res.status(500).json({ error: `Failed to upload: ${err.message}` });
  }
});

app.patch('/api/projects/:slug', async (req, res) => {
  const { slug } = req.params;
  if (!isValidSlug(slug)) {
    return res.status(400).json({ error: 'Invalid project slug' });
  }
  const body = req.body || {};
  const updates = {};
  if (body.layout && typeof body.layout === 'object') {
    updates.layout = body.layout;
  }
  if (Array.isArray(body.terminals)) {
    updates.terminals = body.terminals;
  }
  if (typeof body.name === 'string' && body.name.trim()) {
    updates.name = body.name.trim();
  }
  if (body.fileExplorer && typeof body.fileExplorer === 'object') {
    updates.fileExplorer = body.fileExplorer;
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No valid fields to update' });
  }
  try {
    const updated = await updateProject(slug, updates, projectsDir);
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
    const project = await getProject(slug, projectsDir);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Kill all terminals for this project
    const terminals = terminalManager.list(slug);
    for (const t of terminals) {
      try {
        await terminalManager.destroy(t.id);
      } catch {
        // terminal may already be dead
      }
    }

    await deleteProject(slug, projectsDir);
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

  try {
    const project = await createProject(name, path, projectsDir);

    // Create default terminals: CLI (shell) + Claude
    try {
      const cliTerminal = await terminalManager.create({
        projectSlug: project.slug,
        label: 'CLI',
        cwd: project.path,
      });
      const claudeTerminal = await terminalManager.create({
        projectSlug: project.slug,
        label: 'Claude',
        command: 'claude --dangerously-skip-permissions',
        cwd: project.path,
      });

      // Store terminal IDs and default layout in project config
      await updateProject(project.slug, {
        terminals: [cliTerminal.id, claudeTerminal.id],
        layout: { mode: 'split', activeTab: 0 },
      }, projectsDir);

      // Return the updated project with terminals
      const updated = await getProject(project.slug, projectsDir);
      res.status(201).json(updated);
    } catch (termErr) {
      // Roll back: remove the persisted project config and any terminals
      const terminals = terminalManager.list(project.slug);
      for (const t of terminals) {
        try { await terminalManager.destroy(t.id); } catch {}
      }
      await deleteProject(project.slug, projectsDir);
      return res.status(500).json({ error: `Failed to create terminals: ${termErr.message}` });
    }
  } catch (err) {
    if (err.message.includes('already exists')) {
      return res.status(409).json({ error: err.message });
    }
    res.status(500).json({ error: 'Failed to create project' });
  }
});

// Terminal CRUD endpoints (new direct-PTY path, no tmux)
app.post('/api/terminals', async (req, res) => {
  const { projectSlug, label, command } = req.body || {};
  if (!projectSlug || typeof projectSlug !== 'string') {
    return res.status(400).json({ error: 'projectSlug is required' });
  }

  try {
    let cwd = process.env.HOME;
    try {
      const project = await getProject(projectSlug, projectsDir);
      if (project?.path) cwd = project.path;
    } catch {
      // project doesn't exist, use HOME
    }

    const terminal = await terminalManager.create({ projectSlug, label, command, cwd });
    res.status(201).json(terminal);
  } catch (err) {
    res.status(500).json({ error: `Failed to create terminal: ${err.message}` });
  }
});

app.get('/api/terminals', (req, res) => {
  const terminals = terminalManager.list(req.query.project);
  res.json(terminals);
});

app.get('/api/terminals/:id', (req, res) => {
  const terminal = terminalManager.get(req.params.id);
  if (!terminal) return res.status(404).json({ error: 'Terminal not found' });
  res.json(terminal);
});

app.patch('/api/terminals/:id', async (req, res) => {
  const { label } = req.body || {};
  if (label === undefined) {
    return res.status(400).json({ error: 'No valid fields to update' });
  }

  try {
    const terminal = await terminalManager.update(req.params.id, { label });
    if (!terminal) return res.status(404).json({ error: 'Terminal not found' });
    res.json(terminal);
  } catch (err) {
    res.status(500).json({ error: `Failed to update terminal: ${err.message}` });
  }
});

app.delete('/api/terminals/:id', async (req, res) => {
  try {
    const deleted = await terminalManager.destroy(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Terminal not found' });
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: `Failed to delete terminal: ${err.message}` });
  }
});

// ---------- File Explorer API ----------

/**
 * Helper to resolve a project slug to its root directory path.
 */
async function resolveProjectRoot(slug) {
  if (!isValidSlug(slug)) return null;
  const project = await getProject(slug, projectsDir);
  return project?.path || null;
}

app.get('/api/files', async (req, res) => {
  const { path: dirPath, project, showHidden, showIgnored } = req.query;
  const projectRoot = await resolveProjectRoot(project);
  if (!projectRoot) return res.status(404).json({ error: 'Project not found' });

  try {
    const entries = await listDirectory(projectRoot, dirPath || '.', {
      showHidden: showHidden === 'true',
      showIgnored: showIgnored === 'true',
    });
    res.json(entries);
  } catch (err) {
    if (err.code === 'TRAVERSAL') return res.status(403).json({ error: err.message });
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'Directory not found' });
    res.status(500).json({ error: `Failed to list directory: ${err.message}` });
  }
});

app.get('/api/files/read', async (req, res) => {
  const { path: filePath, project } = req.query;
  const projectRoot = await resolveProjectRoot(project);
  if (!projectRoot) return res.status(404).json({ error: 'Project not found' });
  if (!filePath) return res.status(400).json({ error: 'path is required' });

  try {
    const content = await readFileContent(projectRoot, filePath);
    res.json({ content });
  } catch (err) {
    if (err.code === 'TRAVERSAL') return res.status(403).json({ error: err.message });
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'File not found' });
    if (err.code === 'EISDIR') return res.status(400).json({ error: 'Cannot read a directory' });
    if (err.code === 'TOOLARGE') return res.status(413).json({ error: 'File exceeds 1MB limit' });
    res.status(500).json({ error: `Failed to read file: ${err.message}` });
  }
});

app.put('/api/files/write', async (req, res) => {
  const { path: filePath, content, project } = req.body || {};
  const projectRoot = await resolveProjectRoot(project);
  if (!projectRoot) return res.status(404).json({ error: 'Project not found' });
  if (!filePath) return res.status(400).json({ error: 'path is required' });
  if (typeof content !== 'string') return res.status(400).json({ error: 'content must be a string' });

  try {
    await writeFileContent(projectRoot, filePath, content);
    res.json({ ok: true });
  } catch (err) {
    if (err.code === 'TRAVERSAL') return res.status(403).json({ error: err.message });
    res.status(500).json({ error: `Failed to write file: ${err.message}` });
  }
});

app.post('/api/files/mkdir', async (req, res) => {
  const { path: dirPath, project } = req.body || {};
  const projectRoot = await resolveProjectRoot(project);
  if (!projectRoot) return res.status(404).json({ error: 'Project not found' });
  if (!dirPath) return res.status(400).json({ error: 'path is required' });

  try {
    await createDirectory(projectRoot, dirPath);
    res.json({ ok: true });
  } catch (err) {
    if (err.code === 'TRAVERSAL') return res.status(403).json({ error: err.message });
    res.status(500).json({ error: `Failed to create directory: ${err.message}` });
  }
});

app.post('/api/files/rename', async (req, res) => {
  const { oldPath, newPath, project } = req.body || {};
  const projectRoot = await resolveProjectRoot(project);
  if (!projectRoot) return res.status(404).json({ error: 'Project not found' });
  if (!oldPath || !newPath) return res.status(400).json({ error: 'oldPath and newPath are required' });

  try {
    await renameFile(projectRoot, oldPath, newPath);
    res.json({ ok: true });
  } catch (err) {
    if (err.code === 'TRAVERSAL') return res.status(403).json({ error: err.message });
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'Source file not found' });
    res.status(500).json({ error: `Failed to rename: ${err.message}` });
  }
});

app.delete('/api/files', async (req, res) => {
  const { path: filePath, project } = req.query;
  const projectRoot = await resolveProjectRoot(project);
  if (!projectRoot) return res.status(404).json({ error: 'Project not found' });
  if (!filePath) return res.status(400).json({ error: 'path is required' });

  try {
    await deleteFile(projectRoot, filePath);
    res.json({ ok: true });
  } catch (err) {
    if (err.code === 'TRAVERSAL') return res.status(403).json({ error: err.message });
    if (err.code === 'FORBIDDEN') return res.status(403).json({ error: err.message });
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'File not found' });
    res.status(500).json({ error: `Failed to delete: ${err.message}` });
  }
});

// SPA fallback: serve index.html for client-side routes only
// Skip /api paths (should 404 as JSON) and file-like asset paths (should 404 normally)
app.get('{*path}', (req, res) => {
  if (req.path.startsWith('/api/') || req.path.includes('.')) {
    return res.status(404).json({ error: 'Not found' });
  }
  if (hasClientBuild) {
    res.sendFile(join(clientDistPath, 'index.html'));
  } else {
    res.type('html').send(placeholderHTML);
  }
});

io.on('connection', (socket) => {
  socket.on('disconnect', () => {});
});

export { app, httpServer, io };

let terminalManagerNamespaceRegistered = false;

export async function startServer(port = PORT, { credentialsPath: credPath, projectsDir: projDir, terminalsDir: termDir } = {}) {
  credentialsPath = credPath || getCredentialsPath();
  projectsDir = projDir || getProjectsDir();

  // Set up TerminalManager (direct PTY, no tmux)
  const terminalsDir = termDir || getTerminalsDir();
  terminalManager = new TerminalManager(terminalsDir);

  if (!terminalManagerNamespaceRegistered) {
    setupTerminalManagerNamespace(io, terminalManager);
    terminalManagerNamespaceRegistered = true;
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
