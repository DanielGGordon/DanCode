# server/

Express + Socket.io backend for DanCode.

## What it does

Serves the DanCode web application and manages WebSocket connections for real-time terminal communication. Currently serves a Solarized Dark placeholder page.

## Public interface

- **`GET /`** — Serves the DanCode placeholder page (will be replaced by the React build in production)
- **Socket.io** — Listens for WebSocket connections on the default namespace

## Exports (src/index.js)

- `app` — Express application instance
- `httpServer` — Node.js HTTP server
- `io` — Socket.io server instance
- `startServer(port?)` — Starts the server on the given port (default: 3000). Returns a promise that resolves with the HTTP server.

## How it relates to the project

This is the backend entry point. In later phases it will:
- Serve the React production build from `client/dist/`
- Host the `/terminal` Socket.io namespace for pane I/O via node-pty
- Expose REST API routes for project CRUD and auth
- Manage tmux session lifecycles

## Running

```bash
npm start        # Start server on port 3000
npm run dev      # Start with file watching
npm test         # Run unit tests (Vitest)
npm run test:e2e # Run E2E tests (Playwright, uses system Chromium)
```
