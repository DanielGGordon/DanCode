# server/

Express + Socket.io backend for DanCode.

## What it does

Serves the DanCode web application and manages WebSocket connections for real-time terminal communication. On startup, ensures an auth token exists at `~/.dancode/auth-token` (generating one on first run) and ensures a tmux session (`dancode-test`) exists for terminal connectivity. Currently serves a Solarized Dark placeholder page.

## Public interface

- **`GET /`** — Serves the DanCode placeholder page (will be replaced by the React build in production)
- **`GET /api/projects`** — List all configured projects, sorted alphabetically by name. Returns a JSON array of project objects.
- **`POST /api/projects`** — Create a new project. Accepts `{ name, path }`, validates inputs, writes config to `~/.dancode/projects/<slug>.json`, creates the project directory if needed, and spins up a tmux session `dancode-<slug>` with two panes (shell + Claude). Returns 201 with the project object, 400 for validation errors, 409 for duplicates.
- **Socket.io** — Listens for WebSocket connections on the default namespace
- **Socket.io `/terminal`** — Accepts connections and spawns a node-pty process attached to `tmux attach -t <session>`. Emits `output` events with terminal data; accepts `input` (keystrokes) and `resize` ({ cols, rows }) events.

## Exports (src/index.js)

- `app` — Express application instance
- `httpServer` — Node.js HTTP server
- `io` — Socket.io server instance
- `startServer(port?)` — Starts the server on the given port (default: 3000). Creates the tmux session on listen. Returns a promise that resolves with the HTTP server.

## Exports (src/auth.js)

- `generateToken()` — Generate a cryptographically random 64-character hex token.
- `getTokenPath()` — Returns the path to `~/.dancode/auth-token`.
- `ensureAuthToken(tokenPath?)` — If the token file doesn't exist, generates a new token, writes it to disk (mode 0600), and logs it to the console. Returns `{ token, created }`.
- `readAuthToken(tokenPath?)` — Reads and returns the token from disk.

## Exports (src/projects.js)

- `slugify(name)` — Convert a project name to a URL-safe slug (lowercase, hyphens).
- `getProjectsDir()` — Returns the path to `~/.dancode/projects/`.
- `getProjectConfigPath(slug, projectsDir?)` — Returns path to a project's config file.
- `validateProjectInput(name, path)` — Validate project creation inputs. Returns `{ valid, error? }`.
- `resolvePath(path)` — Resolve a path, expanding `~` to the home directory.
- `createProject(name, path, projectsDir?)` — Create a project config file. Throws on duplicate. Returns project object.
- `listProjects(projectsDir?)` — List all configured projects, sorted by name.
- `getProject(slug, projectsDir?)` — Get a project by slug. Returns null if not found.
- `deleteProject(slug, projectsDir?)` — Delete a project config. Returns boolean.

## Exports (src/tmux.js)

- `sessionExists(name)` — Check whether a tmux session exists. Returns `Promise<boolean>`.
- `createSession(name)` — Create a detached tmux session.
- `ensureSession(name)` — Ensure a tmux session exists, creating it if needed. Returns `Promise<{created: boolean}>`.
- `createProjectSession(slug, projectPath)` — Create a tmux session `dancode-<slug>` with two panes: pane 0 is a shell at the project directory, pane 1 runs `claude --dangerously-skip-permissions` at the project directory. Returns `Promise<{sessionName, created}>`.

## Exports (src/terminal.js)

- `setupTerminalNamespace(io, sessionName)` — Sets up the `/terminal` Socket.io namespace. Each connecting client gets a node-pty process attached to `tmux attach -t <sessionName>`. Returns the namespace.

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
