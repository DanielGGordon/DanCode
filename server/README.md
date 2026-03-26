# server/

Express + Socket.io backend for DanCode.

## What it does

Serves the DanCode web application and manages WebSocket connections for real-time terminal communication. On startup, ensures a tmux session (`dancode-test`) exists for legacy terminal connectivity and initializes the TerminalManager for direct PTY terminals. Serves the compiled React client from `client/dist/` when available, falling back to a Solarized Dark placeholder page.

Two terminal paths coexist:
- **Legacy (tmux-backed):** Socket.io `/terminal` namespace attaches to tmux sessions via node-pty
- **New (direct PTY):** REST CRUD at `/api/terminals` + Socket.io `/terminal/{uuid}` namespace spawns shells directly with ring buffer replay

## Public interface

- **`GET /`** — Serves the React client build from `client/dist/` if available, otherwise a Solarized Dark placeholder page
- **`GET /api/projects`** — List all configured projects, sorted alphabetically by name. Returns a JSON array of project objects.
- **`POST /api/projects`** — Create a new project. Accepts `{ name, path }` for standard projects or `{ name, adoptSession }` to adopt an existing tmux session. Standard mode validates inputs, writes config to `~/.dancode/projects/<slug>.json`, creates the project directory if needed, and spins up a tmux session `dancode-<slug>` with two windows (CLI shell + Claude). Adopt mode links the project to the named tmux session without creating a new one. Returns 201 with the project object, 400 for validation errors, 409 for duplicates.
- **`GET /api/projects/:slug`** — Get a single project by slug. Returns the project JSON object, or 404 if not found.
- **`GET /api/projects/:slug/panes`** — List the tmux windows (panes) for a project's session. Returns a JSON array of `{ index, label }` objects. For adopted sessions, reflects the actual windows in the adopted tmux session. For standard projects, returns the `dancode-<slug>` session's windows.
- **`PATCH /api/projects/:slug`** — Update a project's layout preferences. Accepts `{ layout: { mode, hiddenPanes } }`. Returns the updated project object. Used by the frontend to persist split/tabs mode and pane visibility.
- **`GET /api/tmux-status`** — Returns a JSON object mapping each project slug to a boolean indicating whether its tmux session (`dancode-<slug>`) is currently running. Used by the sidebar to show status dots.
- **`GET /api/tmux/sessions`** — Returns a JSON array of tmux sessions that are NOT already mapped to a DanCode project. Each entry is `{ name }`. Filters out project sessions (`dancode-<slug>` for configured projects) and internal connection sessions (containing `-conn-`). Used by the "Adopt existing tmux session" feature.
- **`DELETE /api/projects/:slug`** — Delete a project's config file. Optionally kills the tmux session with `?killSession=true`. Returns 204 on success, 404 if the project does not exist.
- **`POST /api/terminals`** — Create a direct PTY terminal. Accepts `{ projectSlug, label, command }`. Spawns `$SHELL` (or `/bin/bash`) with cwd set to the project's path. Returns 201 with `{ id, projectSlug, label, createdAt }`. Metadata persisted to `~/.dancode/terminals/{id}.json`.
- **`GET /api/terminals?project=<slug>`** — List terminals, optionally filtered by project slug. Returns a JSON array.
- **`GET /api/terminals/:id`** — Get a single terminal by UUID. Returns 404 if not found.
- **`PATCH /api/terminals/:id`** — Update a terminal's label. Accepts `{ label }`. Returns the updated terminal object.
- **`DELETE /api/terminals/:id`** — Kill the PTY process and remove metadata. Returns 204.
- **Socket.io** — Listens for WebSocket connections on the default namespace
- **Socket.io `/terminal`** — (Legacy) Accepts connections and spawns a node-pty process attached to `tmux attach -t <session>`. Supports optional `pane` query parameter to connect to a specific tmux window via grouped sessions. Emits `output` events with terminal data; accepts `input` (keystrokes) and `resize` ({ cols, rows }) events.
- **Socket.io `/terminal/{uuid}`** — (New) Per-terminal WebSocket namespace. On connect, replays ~50KB ring buffer of past output. Accepts `input` and `resize` events. PTY stays alive when all sockets disconnect; output is buffered for replay on reconnect.

## Exports (src/index.js)

- `app` — Express application instance
- `httpServer` — Node.js HTTP server
- `io` — Socket.io server instance
- `terminalManager` — TerminalManager instance (null until `startServer` is called)
- `startServer(port?, { credentialsPath?, projectsDir?, terminalsDir? })` — Starts the server on the given port (default: 3000). Initializes tmux session, TerminalManager, and WebSocket namespaces. Returns a promise that resolves with the HTTP server.

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

## Exports (src/tmux.js)

- `listSessions()` — List all tmux session names. Returns `Promise<string[]>` (empty if no tmux server).
- `listWindows(sessionName)` — List all windows in a tmux session. Returns `Promise<Array<{index, name}>>` (empty if session doesn't exist).
- `sessionExists(name)` — Check whether a tmux session exists. Returns `Promise<boolean>`.
- `createSession(name)` — Create a detached tmux session.
- `ensureSession(name)` — Ensure a tmux session exists, creating it if needed. Returns `Promise<{created: boolean}>`.
- `createProjectSession(slug, projectPath)` — Create a tmux session `dancode-<slug>` with two windows: window 0 (`cli`) is a shell at the project directory, window 1 (`claude`) runs `claude --dangerously-skip-permissions` at the project directory. Returns `Promise<{sessionName, created}>`.
- `createConnectionSession(targetSession, windowIndex, connId)` — Create a grouped tmux session for viewing a single window independently. Used by the multi-pane web UI. Returns `Promise<string>` (the grouped session name).
- `destroyConnectionSession(connSession)` — Destroy a grouped connection session. Safe to call if already gone.

## Exports (src/terminal.js)

- `setupTerminalNamespace(io, sessionName, resolveSession)` — (Legacy) Sets up the `/terminal` Socket.io namespace. Each connecting client gets a node-pty process attached to `tmux attach -t <sessionName>`. When a `pane` query parameter is provided, creates a grouped tmux session for isolated single-window access. Returns the namespace.

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

This is the backend entry point. It exposes REST API routes for project CRUD and auth, and manages terminal WebSocket connections. In later phases it will:
- Serve the React production build from `client/dist/`
- Manage tmux session lifecycles per project

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
