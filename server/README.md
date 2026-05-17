# server/

Express + Socket.io backend for DanCode.

## What it does

Serves the DanCode web application and manages WebSocket connections for real-time terminal communication. On startup, connects to `dancode-shellhost` over a UNIX socket and rebuilds its in-memory terminal map from shellhost's authoritative state (see Phase 3 / 5 recovery flows). Serves the compiled React client from `client/dist/` when available, falling back to a Solarized Dark placeholder page.

All HTTP responses are gzip-compressed via the `compression` middleware. Static assets use a tiered caching strategy: Vite-hashed files in `assets/` get `Cache-Control: public, max-age=31536000, immutable`; `index.html` gets `no-cache` so app updates propagate immediately; `sw.js` gets `no-cache, no-store, must-revalidate`.

Terminals are managed exclusively via `ShellhostTerminalManager` (see `src/shellhost-terminal-manager.js`). It speaks the length-prefixed JSON wire protocol from `shellhost/src/wire.js`, asks shellhost to spawn/attach/write/kill PTYs, and forwards bytes between Socket.io clients and the shellhost socket. Shellhost owns the PTYs, so a server restart does not affect running shells. The socket path is picked from `DANCODE_SHELLHOST_SOCKET` and defaults to `~/.dancode/shellhost.sock`; `startServer` waits up to 60s for the socket to appear and throws if it never does.

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
- **`POST /api/terminals`** — Create a terminal. Accepts `{ projectSlug, label, command, cwd, background? }`. When `background: true`, shellhost wraps the command in a transient `systemd --user --scope --unit=dancode-bg-<id>` so it survives shellhost restarts (see `docs/background-mode.md`). Returns 201 with `{ id, projectSlug, label, createdAt, lastActivity, background }`.
- **`GET /api/terminals?project=<slug>`** — List terminals, optionally filtered by project slug. Returns a JSON array with `lastActivity` and `background` flag.
- **`GET /api/terminals/:id`** — Get a single terminal by UUID. Returns 404 if not found.
- **`PATCH /api/terminals/:id`** — Update a terminal's label. Accepts `{ label }`. Returns the updated terminal object.
- **`POST /api/terminals/:id/background`** — Toggle background mode on an existing terminal. Accepts `{ background: boolean }`. The flag is persisted to meta immediately; takes effect on next respawn (does not restart a live PTY). 404 for unknown terminal, 400 for non-boolean body.
- **`DELETE /api/terminals/:id`** — Kill the PTY (or `systemctl --user stop dancode-bg-<id>.scope` for background terminals) and remove its meta + scrollback. Returns 204.
- **Socket.io** — Listens for WebSocket connections on the default namespace
- **Socket.io `/terminal/{uuid}`** — Per-terminal WebSocket namespace. On connect, replays ~50KB ring buffer of past output. Accepts `input` and `resize` events. PTY stays alive when all sockets disconnect; output is buffered for replay on reconnect.

## Exports (src/index.js)

- `app` — Express application instance
- `httpServer` — Node.js HTTP server
- `io` — Socket.io server instance
- `terminalManager` — ShellhostTerminalManager instance (null until `startServer` is called)
- `startServer(port?, { credentialsPath?, projectsDir?, layoutsBaseDir?, shellhostSocket? })` — Starts the server on the given port (default: 3000). Connects to dancode-shellhost (defaulting to `~/.dancode/shellhost.sock`; override via the `shellhostSocket` option or `DANCODE_SHELLHOST_SOCKET` env var), recovers existing terminals from shellhost's `list` op, and sets up WebSocket namespaces. Returns a promise that resolves with the HTTP server. Throws if the shellhost socket is not reachable within 60s.

## Exports (src/auth.js)

- `getCredentialsPath()` — Returns the path to `~/.dancode/credentials.json`.
- `isAccountSetUp(credPath?)` — Check if an account has been set up (credentials file exists with valid data).
- `createAccount(username, password, credPath?)` — Create a new account: hash password, generate TOTP secret, save to disk. Returns `{ totpSecret, otpauthUrl, qrCodeDataUrl }`.
- `verifyLogin(username, password, totpCode, credPath?)` — Verify credentials. Returns boolean.
- `createSession(username)` — Create an in-memory session with `createdAt` timestamp. Persists via debounced async write. Returns the session token.
- `validateSession(token)` — Check if a session token is valid and within 30-day TTL. Expired sessions are removed on access. Returns boolean.
- `destroySession(token)` — Remove a session from the store.
- `cleanExpiredSessions()` — Remove all expired sessions (>30 days) from memory and persist. Returns count cleaned.
- `startSessionCleanupInterval()` — Start hourly cleanup of expired sessions.
- `stopSessionCleanupInterval()` — Stop the hourly cleanup interval.
- `flushSessionSave()` — Flush any pending debounced session save immediately (for tests).
- `clearSessions()` — Clear all sessions and cancel pending saves (for tests).

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
- `listDirectory(projectRoot, relativePath, options?)` — List directory contents with metadata. Options: `showHidden`, `showIgnored`. Returns `[{ name, type, size, modified }]`. Uses a per-project-root gitignore cache with 30-second TTL to avoid redundant `.gitignore` reads.
- `readFileContent(projectRoot, relativePath)` — Read file as UTF-8 text (max 1MB).
- `writeFileContent(projectRoot, relativePath, content)` — Write content to a file. Creates parent dirs.
- `createDirectory(projectRoot, relativePath)` — Create a directory (recursive).
- `renameFile(projectRoot, oldRelPath, newRelPath)` — Rename or move a file/directory.
- `deleteFile(projectRoot, relativePath)` — Delete a file or directory recursively.
- `clearGitignoreCache()` — Clear the gitignore cache (for testing).
- `getGitignoreCache()` — Get the gitignore cache Map (for testing/inspection).

## Exports (src/shellhost-terminal-manager.js)

- `ShellhostTerminalManager` — Server-side adapter that fronts a dancode-shellhost over a UNIX socket with the shape `index.js` expects:
  - `constructor({ socketPath, client? })` — Builds a `createShellhostClient` (or accepts a pre-built one for tests) and wires `output`, `exit`, `error`, and `close` listeners. Output bytes are fanned out to attached Socket.io sockets.
  - `recover()` — Calls shellhost `list`, rebuilds the in-memory terminal map, and attaches each terminal so live output flows. Used on server boot. Returns the count of recovered terminals (live + needs-respawn).
  - `create({ projectSlug, label, command, cols, rows, cwd, background })` — Calls shellhost `spawn` and registers the new terminal in the in-memory map. Returns `{ id, projectSlug, label, createdAt, lastActivity, background }`.
  - `setBackground(id, background)` — Calls shellhost `setBackground` to flip the persisted background flag.
  - `respawnForProject(slug)` — Asks shellhost to respawn any `needsRespawn` terminals for the given project (Phase 5 Pi-reboot recovery).
  - `get(id) / list(projectSlug?) / getFresh(id) / listFresh(projectSlug?)` — Synchronous + async getters (the *Fresh variants round-trip through shellhost's `inspect` op for latest `claudeSessionId` + `lastActivity`).
  - `update(id, { label })` — Updates the in-memory label only (label is server-side state, not persisted via shellhost).
  - `destroy(id) / destroyAll()` — Calls shellhost `kill` and clears the local entry.
  - `attach(id, socket) / detach(id, socket) / write(id, data) / resize(id, cols, rows)` — Per-socket plumbing; `attach` replays disk scrollback via shellhost `getScrollback` rather than keeping a server-memory ring.
  - `reconnect(socketPath)` — Re-points the manager at a new shellhost (used by the test-only restart endpoint).
- `setupShellhostNamespace(io, getManager)` — Sets up the Socket.io dynamic `/terminal/{uuid}` namespace. Takes a getter so the namespace handler always resolves the live `terminalManager` (important when an in-process test simulates a server restart).

## Migration from the legacy tmux backend

`bin/dancode-migrate-from-tmux` (Phase 9) converts any pre-existing `dancode-*` tmux sessions into the new on-disk format and kills the source sessions. Run it once before starting the new stack against a host that previously ran the tmux-backed build. The script is idempotent — re-runs are no-ops.

## How it relates to the project

This is the backend entry point. It exposes REST API routes for project CRUD, auth, layout persistence, and terminal management, and proxies per-terminal WebSocket connections to `dancode-shellhost`.

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
