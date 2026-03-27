# server/

Express + Socket.io backend for DanCode.

## What it does

Serves the DanCode web application and manages WebSocket connections for real-time terminal communication. On startup, initializes the TerminalManager for direct PTY terminal spawning. Serves the compiled React client from `client/dist/` when available, falling back to a Solarized Dark placeholder page.

Terminals are managed via the TerminalManager: REST CRUD at `/api/terminals` + Socket.io `/terminal/{uuid}` namespace spawns shells directly with ~50KB ring buffer replay for reconnection.

## Public interface

- **`GET /`** — Serves the React client build from `client/dist/` if available, otherwise a Solarized Dark placeholder page
- **`GET /api/projects`** — List all configured projects, sorted alphabetically by name. Returns a JSON array of project objects.
- **`POST /api/projects`** — Create a new project. Accepts `{ name, path }`. Validates inputs, writes config to `~/.dancode/projects/<slug>.json`, creates the project directory if needed, and creates 2 terminals (CLI + Claude) via TerminalManager. Returns 201 with the project object, 400 for validation errors, 409 for duplicates.
- **`GET /api/projects/:slug`** — Get a single project by slug. Returns the project JSON object, or 404 if not found.
- **`PATCH /api/projects/:slug`** — Update a project's config (layout preferences, terminal order). Accepts `{ layout: { mode, activeTab }, terminals: [...ids] }`. Returns the updated project object.
- **`DELETE /api/projects/:slug`** — Delete a project's config file and its associated terminals. Returns 204 on success, 404 if the project does not exist.
- **`GET /api/files?path=<dir>&project=<slug>`** — List directory contents. Returns `[{ name, type, size, modified }]`. Supports `showHidden` and `showIgnored` query params.
- **`GET /api/files/read?path=<file>&project=<slug>`** — Read file contents (up to 1MB). Returns `{ content }`.
- **`PUT /api/files/write`** — Write file. Accepts `{ path, content, project }`. Creates parent dirs if needed.
- **`POST /api/files/mkdir`** — Create directory. Accepts `{ path, project }`.
- **`POST /api/files/rename`** — Rename/move. Accepts `{ oldPath, newPath, project }`.
- **`DELETE /api/files?path=<path>&project=<slug>`** — Delete file or directory.
- **`POST /api/terminals`** — Create a direct PTY terminal. Accepts `{ projectSlug, label, command, cwd }`. Spawns `$SHELL` (or `/bin/bash`) with cwd set to the project's path (or custom cwd). Returns 201 with `{ id, projectSlug, label, createdAt }`. Metadata persisted to `~/.dancode/terminals/{id}.json`.
- **`GET /api/terminals?project=<slug>`** — List terminals, optionally filtered by project slug. Returns a JSON array.
- **`GET /api/terminals/:id`** — Get a single terminal by UUID. Returns 404 if not found.
- **`PATCH /api/terminals/:id`** — Update a terminal's label. Accepts `{ label }`. Returns the updated terminal object.
- **`DELETE /api/terminals/:id`** — Kill the PTY process and remove metadata. Returns 204.
- **Socket.io** — Listens for WebSocket connections on the default namespace
- **Socket.io `/terminal/{uuid}`** — Per-terminal WebSocket namespace. On connect, replays ~50KB ring buffer of past output. Accepts `input` and `resize` events. PTY stays alive when all sockets disconnect; output is buffered for replay on reconnect.

## Exports (src/index.js)

- `app` — Express application instance
- `httpServer` — Node.js HTTP server
- `io` — Socket.io server instance
- `terminalManager` — TerminalManager instance (null until `startServer` is called)
- `startServer(port?, { credentialsPath?, projectsDir?, terminalsDir? })` — Starts the server on the given port (default: 3000). Initializes TerminalManager and WebSocket namespaces. Returns a promise that resolves with the HTTP server.

## Exports (src/auth.js)

- `getCredentialsPath()` — Returns the path to `~/.dancode/credentials.json`.
- `isAccountSetUp(credPath?)` — Check if an account has been set up (credentials file exists with valid data).
- `createAccount(username, password, credPath?)` — Create a new account: hash password, generate TOTP secret, save to disk. Returns `{ totpSecret, otpauthUrl, qrCodeDataUrl }`.
- `verifyLogin(username, password, totpCode, credPath?)` — Verify credentials. Returns boolean.
- `createSession(username)` — Create an in-memory session. Returns the session token.
- `validateSession(token)` — Check if a session token is valid. Returns boolean.
- `destroySession(token)` — Remove a session from the store.
- `clearSessions()` — Clear all sessions (for tests).

## Exports (src/projects.js)

- `slugify(name)` — Convert a project name to a URL-safe slug (lowercase, hyphens).
- `getProjectsDir()` — Returns the path to `~/.dancode/projects/`.
- `getProjectConfigPath(slug, projectsDir?)` — Returns path to a project's config file.
- `validateProjectInput(name, path)` — Validate project creation inputs. Returns `{ valid, error? }`.
- `resolvePath(path)` — Resolve a path, expanding `~` to the home directory.
- `createProject(name, path, projectsDir?)` — Create a project config file. Throws on duplicate. Returns project object.
- `listProjects(projectsDir?)` — List all configured projects, sorted by name.
- `getProject(slug, projectsDir?)` — Get a project by slug. Returns null if not found.
- `updateProject(slug, updates, projectsDir?)` — Merge updates into an existing project config. Returns the updated object, or null if not found.
- `deleteProject(slug, projectsDir?)` — Delete a project config. Returns boolean.

## Exports (src/files.js)

- `safePath(projectRoot, requestedPath)` — Resolve and validate a path stays within the project directory. Resolves symlinks.
- `listDirectory(projectRoot, relativePath, options?)` — List directory contents with metadata. Options: `showHidden`, `showIgnored`. Returns `[{ name, type, size, modified }]`.
- `readFileContent(projectRoot, relativePath)` — Read file as UTF-8 text (max 1MB).
- `writeFileContent(projectRoot, relativePath, content)` — Write content to a file. Creates parent dirs.
- `createDirectory(projectRoot, relativePath)` — Create a directory (recursive).
- `renameFile(projectRoot, oldRelPath, newRelPath)` — Rename or move a file/directory.
- `deleteFile(projectRoot, relativePath)` — Delete a file or directory recursively.

## Exports (src/tmux.js) — Legacy, emptied

Module preserved for potential Phase 4 re-integration. All exports removed in Phase 2.

## Exports (src/terminal.js) — Legacy, emptied

Module preserved for potential Phase 4 re-integration. All exports removed in Phase 2.

## Exports (src/terminal-manager.js)

- `getTerminalsDir()` — Returns the path to `~/.dancode/terminals/`.
- `TerminalManager` — Class managing direct PTY terminal processes:
  - `constructor(terminalsDir?)` — Create a manager with optional custom metadata directory.
  - `create({ projectSlug, label, command, cols, rows, cwd })` — Spawn a PTY, persist metadata, return `{ id, projectSlug, label, createdAt }`.
  - `get(id)` — Get terminal metadata. Returns null if not found.
  - `list(projectSlug?)` — List terminals, optionally filtered by project.
  - `update(id, { label })` — Update terminal metadata.
  - `destroy(id)` — Kill PTY, disconnect sockets, remove metadata file.
  - `attach(id, socket)` — Attach a WebSocket, replay ring buffer.
  - `detach(id, socket)` — Detach a WebSocket.
  - `write(id, data)` — Write to PTY stdin.
  - `resize(id, cols, rows)` — Resize PTY.
  - `destroyAll()` — Destroy all managed terminals (cleanup).
- `setupTerminalManagerNamespace(io, manager)` — Sets up Socket.io dynamic namespace matching `/terminal/{uuid}`. Auth middleware validates session tokens. On connection, attaches socket to the terminal, replays buffered output, and routes input/resize events.

## How it relates to the project

This is the backend entry point. It exposes REST API routes for project CRUD, auth, and terminal management, and manages per-terminal WebSocket connections via TerminalManager.

## Testing

### Unit tests (Vitest)
```bash
npm test
```

### E2E tests (Playwright + Midscene.js)
```bash
npm run test:e2e
```

E2E tests use Playwright for browser automation. Visual assertions use two approaches:

- **Midscene.js** (`tests/e2e/fixture.js`): DOM-based AI assertions via local Ollama (phi3.5). Import `test`/`expect` from `fixture.js` for `aiAssert`, `aiQuery`, etc.
- **Screenshot pixel analysis** (`terminal-visual.spec.js`): Programmatic color verification for canvas-rendered content (xterm.js). Used because Pi 5 ARM64 lacks a working local vision model (moondream crashes, qwen2.5vl needs 10GB+).

**Configuration:** Midscene environment variables are in `server/.env` (git-ignored). See `.env` for the Ollama endpoint, model name, and model family settings.

## Running

```bash
npm start        # Start server on port 3000
npm run dev      # Start with file watching
```
