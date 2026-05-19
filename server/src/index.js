import express from 'express';
import compression from 'compression';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { isAccountSetUp, createAccount, verifyLogin, createSession, validateSession, destroySession, getCredentialsPath, startSessionCleanupInterval } from './auth.js';
import { validateProjectInput, createProject, listProjects, getProject, updateProject, deleteProject, renameProject, getProjectsDir, slugify, isValidSlug, writeProjectOrder } from './projects.js';
import { ShellhostTerminalManager, setupShellhostNamespace } from './shellhost-terminal-manager.js';
import { homedir as osHomedir } from 'node:os';

/**
 * Default shellhost socket path: `${HOME}/.dancode/shellhost.sock`. The dev
 * script overrides this with /tmp/dancode-shellhost-dev.sock and tests with
 * a per-suite temp path; both come in via DANCODE_SHELLHOST_SOCKET.
 */
function defaultShellhostSocket() {
  return join(osHomedir(), '.dancode', 'shellhost.sock');
}
import { listDirectory, readFileContent, writeFileContent, createDirectory, renameFile, deleteFile, safePath, getFileStats } from './files.js';
import { getSystemStats, listDirsForCompletion } from './system.js';
import { defaultLayout, validateLayout, readLayout, writeLayout, removeMissingFiles, getLayoutsBaseDir } from './layout.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = process.env.PORT || 3000;

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { transports: ['websocket'] });

let projectsDir = null;
let credentialsPath = null;
let layoutsBaseDir = null;
export let terminalManager = null;

// Gzip/deflate/brotli compression on all HTTP responses
app.use(compression());

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
  // Phase 3: test-only kill endpoint is gated by NODE_ENV=test inside the
  // handler itself; allow it through without a session token.
  if (req.path === '/test-only/kill-server' && process.env.NODE_ENV === 'test') {
    return next();
  }
  // Phase 5: test-only shellhost-restart endpoint is gated by NODE_ENV=test
  // inside the handler; allow it through without a session token.
  if (req.path === '/test-only/restart-shellhost' && process.env.NODE_ENV === 'test') {
    return next();
  }
  // Phase 7: test-only note-claude-session endpoint, same gate.
  if (req.path === '/test-only/note-claude-session' && process.env.NODE_ENV === 'test') {
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
  // Prevent browser from caching sw.js so updates take effect immediately
  app.get('/sw.js', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(join(clientDistPath, 'sw.js'));
  });

  // Vite-hashed assets (JS/CSS in assets/) get aggressive immutable caching
  app.use('/assets', express.static(join(clientDistPath, 'assets'), {
    maxAge: '1y',
    immutable: true,
  }));

  // index.html and other root-level static files get no-cache so app updates propagate
  app.use(express.static(clientDistPath, {
    setHeaders(res, filePath) {
      if (filePath.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-cache');
      }
    },
  }));
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

app.put('/api/projects/order', async (req, res) => {
  const { order } = req.body || {};
  if (!Array.isArray(order)) {
    return res.status(400).json({ error: 'order must be an array of slugs' });
  }
  try {
    const saved = await writeProjectOrder(order);
    res.json({ order: saved });
  } catch (err) {
    res.status(500).json({ error: `Failed to save project order: ${err.message}` });
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

  // Rename support: when `name` is provided, slugify the new name and (if it
  // differs from the current slug) move both the config file and the per-
  // project layout directory.
  let workingSlug = slug;
  let renamed = null;
  if (typeof body.name === 'string' && body.name.trim()) {
    try {
      const r = await renameProject(slug, body.name, {
        projectsDir,
        layoutsBaseDir,
      });
      if (!r) {
        return res.status(404).json({ error: 'Project not found' });
      }
      workingSlug = r.slug;
      renamed = r;
    } catch (err) {
      if (err.code === 'INVALID_NAME') {
        return res.status(400).json({ error: err.message });
      }
      if (err.code === 'CONFLICT') {
        return res.status(409).json({ error: err.message });
      }
      return res.status(500).json({ error: `Failed to rename project: ${err.message}` });
    }
  }

  const updates = {};
  if (body.layout && typeof body.layout === 'object') {
    updates.layout = body.layout;
  }
  if (Array.isArray(body.terminals)) {
    updates.terminals = body.terminals;
  }
  if (body.fileExplorer && typeof body.fileExplorer === 'object') {
    updates.fileExplorer = body.fileExplorer;
  }

  if (Object.keys(updates).length === 0) {
    if (renamed) return res.json(renamed);
    return res.status(400).json({ error: 'No valid fields to update' });
  }
  try {
    const updated = await updateProject(workingSlug, updates, projectsDir);
    if (!updated) {
      return res.status(404).json({ error: 'Project not found' });
    }
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update project' });
  }
});

app.get('/api/projects/:slug/layout', async (req, res) => {
  const { slug } = req.params;
  if (!isValidSlug(slug)) {
    return res.status(400).json({ error: 'Invalid project slug' });
  }
  try {
    const project = await getProject(slug, projectsDir);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    const layout = await readLayout(slug, layoutsBaseDir);
    const { layout: cleaned, missing } = await removeMissingFiles(layout, project.path);
    // Phase 5: opening a project triggers respawn of any terminals in the
    // project that are still marked needs-respawn (because the shellhost
    // restarted between the prior session and now). We fire-and-await so
    // the client can immediately attach via WebSocket below.
    if (terminalManager?.respawnForProject) {
      try { await terminalManager.respawnForProject(slug); } catch { /* best-effort */ }
    }
    // Include all openFiles in the response (the client decides what to do with
    // each), but annotate which ones are missing so the UI can render banners.
    res.json({ ...layout, missingFiles: missing });
  } catch (err) {
    res.status(500).json({ error: `Failed to read layout: ${err.message}` });
  }
});

app.put('/api/projects/:slug/layout', async (req, res) => {
  const { slug } = req.params;
  if (!isValidSlug(slug)) {
    return res.status(400).json({ error: 'Invalid project slug' });
  }
  const payload = req.body;
  const v = validateLayout(payload);
  if (!v.valid) {
    return res.status(400).json({ error: v.error });
  }
  try {
    const project = await getProject(slug, projectsDir);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    await writeLayout(slug, payload, layoutsBaseDir);
    res.json({ ok: true });
  } catch (err) {
    if (err.code === 'INVALID_LAYOUT') {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: `Failed to write layout: ${err.message}` });
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

// Terminal CRUD endpoints — all PTYs are owned by dancode-shellhost.
app.post('/api/terminals', async (req, res) => {
  const { projectSlug, label, command, cwd: requestedCwd, background } = req.body || {};
  if (!projectSlug || typeof projectSlug !== 'string') {
    return res.status(400).json({ error: 'projectSlug is required' });
  }
  if (background !== undefined && typeof background !== 'boolean') {
    return res.status(400).json({ error: 'background must be a boolean' });
  }

  try {
    let cwd = process.env.HOME;
    try {
      const project = await getProject(projectSlug, projectsDir);
      if (project?.path) {
        cwd = project.path;
        // If a relative cwd was provided, resolve it within the project directory
        if (requestedCwd && !requestedCwd.startsWith('/')) {
          const resolved = join(project.path, requestedCwd);
          // Validate it stays within the project
          if (resolved.startsWith(project.path + '/') || resolved === project.path) {
            cwd = resolved;
          }
        } else if (requestedCwd && requestedCwd.startsWith('/')) {
          cwd = requestedCwd;
        }
      }
    } catch {
      // project doesn't exist, use HOME
    }

    const terminal = await terminalManager.create({
      projectSlug,
      label,
      command,
      cwd,
      background: !!background,
    });
    res.status(201).json(terminal);
  } catch (err) {
    res.status(500).json({ error: `Failed to create terminal: ${err.message}` });
  }
});

// Phase 8: Toggle background-mode on an existing terminal. The flag is
// persisted to meta immediately and takes effect on the PTY on next respawn.
app.post('/api/terminals/:id/background', async (req, res) => {
  const { background } = req.body || {};
  if (typeof background !== 'boolean') {
    return res.status(400).json({ error: 'background must be a boolean' });
  }
  if (typeof terminalManager.setBackground !== 'function') {
    return res.status(501).json({ error: 'background mode not supported by this backend' });
  }
  try {
    const terminal = await terminalManager.setBackground(req.params.id, background);
    if (!terminal) return res.status(404).json({ error: 'Terminal not found' });
    res.json(terminal);
  } catch (err) {
    res.status(500).json({ error: `Failed to toggle background: ${err.message}` });
  }
});

app.get('/api/terminals', async (req, res) => {
  // Phase 7: pull a fresh snapshot from shellhost so callers see the
  // latest claudeSessionId (the detector writes it periodically).
  const terminals = typeof terminalManager.listFresh === 'function'
    ? await terminalManager.listFresh(req.query.project)
    : terminalManager.list(req.query.project);
  res.json(terminals);
});

app.get('/api/terminals/:id', async (req, res) => {
  const terminal = typeof terminalManager.getFresh === 'function'
    ? await terminalManager.getFresh(req.params.id)
    : terminalManager.get(req.params.id);
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
    // Compute ETag from file mtime + size
    const stats = await getFileStats(projectRoot, filePath);
    const etag = `"${Math.floor(stats.mtimeMs).toString(36)}-${stats.size.toString(36)}"`;
    res.setHeader('ETag', etag);

    // Handle conditional request
    const ifNoneMatch = req.headers['if-none-match'];
    if (ifNoneMatch && ifNoneMatch === etag) {
      return res.status(304).end();
    }

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

// ---------- RESTful per-project file routes (Phase 6) ----------
// These mirror the legacy /api/files/read|write but with a cleaner shape:
// the project slug lives in the URL, the file path is a wildcard suffix,
// and request bodies don't repeat the project/path. Path safety is
// enforced by safePath() inside files.js (TRAVERSAL → 403).

/**
 * Pull the wildcard segment(s) out of req.params (Express 5 returns either
 * a string or an array depending on path-to-regexp version), normalize to a
 * single relative path string.
 */
function extractWildcardPath(params) {
  // path-to-regexp 8 (Express 5) puts the capture under the wildcard name.
  // It's typically an array of decoded segments.
  const raw = params.filepath ?? params['0'] ?? '';
  if (Array.isArray(raw)) return raw.join('/');
  return String(raw);
}

app.get('/api/projects/:slug/files/{*filepath}', async (req, res) => {
  const { slug } = req.params;
  if (!isValidSlug(slug)) return res.status(400).json({ error: 'Invalid project slug' });
  const projectRoot = await resolveProjectRoot(slug);
  if (!projectRoot) return res.status(404).json({ error: 'Project not found' });
  const filePath = extractWildcardPath(req.params);
  if (!filePath) return res.status(400).json({ error: 'path is required' });

  try {
    const stats = await getFileStats(projectRoot, filePath);
    const etag = `"${Math.floor(stats.mtimeMs).toString(36)}-${stats.size.toString(36)}"`;
    res.setHeader('ETag', etag);
    const ifNoneMatch = req.headers['if-none-match'];
    if (ifNoneMatch && ifNoneMatch === etag) {
      return res.status(304).end();
    }
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

app.put('/api/projects/:slug/files/{*filepath}', async (req, res) => {
  const { slug } = req.params;
  if (!isValidSlug(slug)) return res.status(400).json({ error: 'Invalid project slug' });
  const projectRoot = await resolveProjectRoot(slug);
  if (!projectRoot) return res.status(404).json({ error: 'Project not found' });
  const filePath = extractWildcardPath(req.params);
  if (!filePath) return res.status(400).json({ error: 'path is required' });

  const { content } = req.body || {};
  if (typeof content !== 'string') {
    return res.status(400).json({ error: 'content must be a string' });
  }

  try {
    await writeFileContent(projectRoot, filePath, content);
    res.json({ ok: true });
  } catch (err) {
    if (err.code === 'TRAVERSAL') return res.status(403).json({ error: err.message });
    res.status(500).json({ error: `Failed to write file: ${err.message}` });
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

// ---------- System info (CPU/memory + dir autocomplete) ----------

app.get('/api/system/stats', async (req, res) => {
  try {
    const stats = await getSystemStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: `Failed to read system stats: ${err.message}` });
  }
});

app.get('/api/system/dirs', async (req, res) => {
  const { path: inputPath } = req.query;
  try {
    const result = await listDirsForCompletion(typeof inputPath === 'string' ? inputPath : '');
    res.json(result);
  } catch (err) {
    if (err.code === 'ENOENT') return res.json({ base: '', entries: [] });
    if (err.code === 'EACCES') return res.status(403).json({ error: 'Permission denied' });
    res.status(500).json({ error: `Failed to list directories: ${err.message}` });
  }
});

// Test-only endpoint: kill the server process. Used by Phase 3's restart
// E2E to simulate a hard SIGTERM in a way that Playwright can trigger from
// the browser. Guarded by NODE_ENV=test so it cannot be reached in any
// non-test deployment.
app.post('/api/test-only/kill-server', (req, res) => {
  if (process.env.NODE_ENV !== 'test') {
    return res.status(404).json({ error: 'Not found' });
  }
  res.json({ ok: true });
  // Defer the actual exit so the response can flush.
  setTimeout(() => process.exit(0), 10);
});

// Test-only endpoint: SIGKILL the running shellhost (the supervisor will
// respawn it), then reconnect the server's UNIX-socket client to the new
// shellhost. Used by Phase 5's Pi-reboot-simulation E2E. Guarded by
// NODE_ENV=test inside the handler.
app.post('/api/test-only/restart-shellhost', async (req, res) => {
  if (process.env.NODE_ENV !== 'test') {
    return res.status(404).json({ error: 'Not found' });
  }
  let stage = 'init';
  try {
    const { readFileSync } = await import('node:fs');
    const pidFile = process.env.DANCODE_SHELLHOST_PIDFILE;
    if (!pidFile) {
      return res.status(500).json({ error: 'DANCODE_SHELLHOST_PIDFILE not set' });
    }
    let pid;
    try {
      pid = parseInt(readFileSync(pidFile, 'utf8').trim(), 10);
    } catch (err) {
      return res.status(500).json({ error: `Failed to read pidfile: ${err.message}` });
    }
    if (!Number.isInteger(pid) || pid <= 0) {
      return res.status(500).json({ error: `Invalid pid in pidfile: ${pid}` });
    }
    // Kill the running shellhost. The supervisor (boot-stack) auto-respawns
    // it on the same socket; we wait for the new shellhost to come up.
    stage = `kill pid=${pid}`;
    try { process.kill(pid, 'SIGKILL'); } catch { /* already dead */ }

    const sockPath = process.env.DANCODE_SHELLHOST_SOCKET;
    if (!sockPath) {
      return res.status(500).json({ error: 'DANCODE_SHELLHOST_SOCKET not set' });
    }

    // Wait briefly for the supervisor to bring up the replacement shellhost.
    stage = 'wait-for-new-shellhost';
    // Give the supervisor a beat to detect the exit and start the respawn
    // before we begin polling the socket.
    await new Promise((r) => setTimeout(r, 250));
    // Also wait until the pidfile reflects a DIFFERENT pid than the one we
    // killed — that confirms shellhost wrote a new pidfile, so we're not
    // racing the polling against the dying socket.
    const newPidReady = await waitForNewShellhostPid(pidFile, pid, 30_000);
    if (!newPidReady) {
      return res.status(500).json({ error: 'Replacement shellhost did not write a new pidfile in time' });
    }
    const newReady = await waitForShellhost(sockPath, 30_000);
    if (!newReady) {
      return res.status(500).json({ error: 'Replacement shellhost did not come up in time' });
    }

    // Reconnect the in-process manager and recover the orphan list.
    stage = 'reconnect';
    if (terminalManager?.reconnect) {
      await terminalManager.reconnect(sockPath);
    }

    res.json({ ok: true });
  } catch (err) {
    console.error(`[restart-shellhost] failed at stage=${stage}:`, err);
    res.status(500).json({ error: `restart-shellhost failed at stage=${stage}: ${err.message}` });
  }
});

/**
 * Poll the pidfile until it contains a pid != killedPid. Returns true on
 * success, false on timeout.
 */
async function waitForNewShellhostPid(pidFile, killedPid, totalTimeoutMs) {
  const { readFileSync, existsSync: ex } = await import('node:fs');
  const start = Date.now();
  while (Date.now() - start < totalTimeoutMs) {
    if (ex(pidFile)) {
      try {
        const cur = parseInt(readFileSync(pidFile, 'utf8').trim(), 10);
        if (Number.isInteger(cur) && cur !== killedPid && cur > 0) return true;
      } catch { /* ignore transient file races */ }
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

// Test-only endpoint: write a fake claudeSessionId for a terminal so the
// Phase 7 Resume-Claude E2E can verify the UI without actually running
// the real `claude` binary. Guarded by NODE_ENV=test inside the handler.
app.post('/api/test-only/note-claude-session', async (req, res) => {
  if (process.env.NODE_ENV !== 'test') {
    return res.status(404).json({ error: 'Not found' });
  }
  const { terminalId, sessionId } = req.body || {};
  if (!terminalId || typeof terminalId !== 'string') {
    return res.status(400).json({ error: 'terminalId is required' });
  }
  if (!terminalManager?.client?.noteClaudeSession) {
    return res.status(500).json({ error: 'shellhost client not available' });
  }
  try {
    await terminalManager.client.noteClaudeSession(terminalId, sessionId ?? null);
    // Also update the local cache so the very next GET /api/terminals
    // returns the new session id without needing the periodic refresh.
    const entry = terminalManager.terminals?.get?.(terminalId);
    if (entry) entry.claudeSessionId = sessionId ?? null;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: `noteClaudeSession failed: ${err.message}` });
  }
});

// SPA fallback: serve index.html for client-side routes only
// Skip /api paths (should 404 as JSON) and file-like asset paths (should 404 normally)
app.get('{*path}', (req, res) => {
  if (req.path.startsWith('/api/') || req.path.includes('.')) {
    return res.status(404).json({ error: 'Not found' });
  }
  if (hasClientBuild) {
    res.setHeader('Cache-Control', 'no-cache');
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

export async function startServer(port = PORT, {
  credentialsPath: credPath,
  projectsDir: projDir,
  layoutsBaseDir: layoutBase,
  shellhostSocket,
} = {}) {
  credentialsPath = credPath || getCredentialsPath();
  projectsDir = projDir || getProjectsDir();
  layoutsBaseDir = layoutBase || getLayoutsBaseDir();

  // dancode-shellhost is the only terminal backend; wait up to 60s for the
  // socket to appear (production runs supervised by systemd; tests boot a
  // shellhost in beforeAll). If it never appears, fail fast.
  const sockPath = shellhostSocket || process.env.DANCODE_SHELLHOST_SOCKET
    || defaultShellhostSocket();
  const waitMs = 60_000;
  const shellhostReachable = await waitForShellhost(sockPath, waitMs);
  if (!shellhostReachable) {
    throw new Error(`[startup] dancode-shellhost socket ${sockPath} was not reachable after ${waitMs}ms`);
  }

  terminalManager = new ShellhostTerminalManager({ socketPath: sockPath });
  // Eagerly establish the client connection so output/exit events flow.
  await terminalManager.client.connect();
  // Phase 3: rebuild the in-memory terminal map from shellhost's `list`.
  // This is the server-restart recovery primitive — PTYs spawned before
  // the previous server died are still alive in shellhost, and we pick
  // them back up here without disturbing them.
  const recovered = await terminalManager.recover();
  if (recovered > 0) {
    console.log(`[startup] Recovered ${recovered} terminal${recovered === 1 ? '' : 's'} from shellhost`);
  }
  if (!terminalManagerNamespaceRegistered) {
    // Pass a getter so the namespace handler always resolves the current
    // module-level `terminalManager` — important when a single Node process
    // simulates a server restart in tests.
    setupShellhostNamespace(io, () => terminalManager);
    terminalManagerNamespaceRegistered = true;
  }
  console.log(`[startup] Terminals backed by shellhost at ${sockPath}`);

  // Start hourly cleanup of expired sessions (30-day TTL)
  startSessionCleanupInterval();

  return new Promise((resolve) => {
    httpServer.listen(port, () => {
      console.log(`DanCode server listening on http://localhost:${port}`);
      resolve(httpServer);
    });
  });
}

/**
 * One-shot reachability check for a UNIX domain socket.
 */
async function isShellhostReachable(socketPath) {
  const { connect } = await import('node:net');
  const { stat } = await import('node:fs/promises');
  try {
    const st = await stat(socketPath);
    if (!st.isSocket()) return false;
  } catch {
    return false;
  }
  return new Promise((resolve) => {
    const sock = connect(socketPath);
    const cleanup = () => { try { sock.destroy(); } catch { /* ignore */ } };
    const timer = setTimeout(() => { cleanup(); resolve(false); }, 200);
    sock.once('connect', () => { clearTimeout(timer); cleanup(); resolve(true); });
    sock.once('error', () => { clearTimeout(timer); cleanup(); resolve(false); });
  });
}

/**
 * Poll for shellhost readiness up to totalTimeoutMs. Returns true as soon as the
 * socket accepts a connection; returns false if the timeout elapses first.
 */
async function waitForShellhost(socketPath, totalTimeoutMs) {
  if (totalTimeoutMs <= 0) return isShellhostReachable(socketPath);
  const start = Date.now();
  while (Date.now() - start < totalTimeoutMs) {
    if (await isShellhostReachable(socketPath)) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

// Start the server when run directly (not imported for tests)
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startServer();
}
