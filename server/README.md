# server/

Express + Socket.io backend for DanCode.

## What it does

Serves the DanCode web application and manages WebSocket connections for real-time terminal communication. On startup, ensures a tmux session (`dancode-test`) exists for terminal connectivity. Currently serves a Solarized Dark placeholder page.

## Public interface

- **`GET /`** — Serves the DanCode placeholder page (will be replaced by the React build in production)
- **Socket.io** — Listens for WebSocket connections on the default namespace
- **Socket.io `/terminal`** — Accepts connections and spawns a node-pty process attached to `tmux attach -t <session>`. Emits `output` events with terminal data; accepts `input` (keystrokes) and `resize` ({ cols, rows }) events.

## Exports (src/index.js)

- `app` — Express application instance
- `httpServer` — Node.js HTTP server
- `io` — Socket.io server instance
- `startServer(port?)` — Starts the server on the given port (default: 3000). Creates the tmux session on listen. Returns a promise that resolves with the HTTP server.

## Exports (src/tmux.js)

- `sessionExists(name)` — Check whether a tmux session exists. Returns `Promise<boolean>`.
- `createSession(name)` — Create a detached tmux session.
- `ensureSession(name)` — Ensure a tmux session exists, creating it if needed. Returns `Promise<{created: boolean}>`.

## Exports (src/terminal.js)

- `setupTerminalNamespace(io, sessionName)` — Sets up the `/terminal` Socket.io namespace. Each connecting client gets a node-pty process attached to `tmux attach -t <sessionName>`. Returns the namespace.

## How it relates to the project

This is the backend entry point. In later phases it will:
- Serve the React production build from `client/dist/`
- Expose REST API routes for project CRUD and auth
- Manage tmux session lifecycles

## Testing

### Unit tests (Vitest)
```bash
npm test
```

### E2E tests (Playwright + Midscene.js)
```bash
npm run test:e2e
```

E2E tests use Playwright for browser automation. AI-powered visual assertions are available via Midscene.js, which connects to a local Ollama instance for inference.

**Midscene fixture:** Import `test` and `expect` from `tests/e2e/fixture.js` instead of `@playwright/test` to get access to `aiAssert`, `aiQuery`, and other AI methods.

**Configuration:** Midscene environment variables are in `server/.env` (git-ignored). See `.env` for the Ollama endpoint, model name, and model family settings.

## Running

```bash
npm start        # Start server on port 3000
npm run dev      # Start with file watching
```
