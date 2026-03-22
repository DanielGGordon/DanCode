# DanCode Client

React + Vite + Tailwind CSS frontend for DanCode.

## Development

```bash
npm run dev    # Start dev server on http://localhost:5173
npm run build  # Production build to dist/
npm test       # Run unit tests (Vitest)
```

The dev server proxies `/api` and `/socket.io` requests to the backend at `http://localhost:3000`.

## Public interface

- `App` — Root component, checks localStorage for auth token; shows `LoginScreen` if absent, otherwise renders the header with "New Project" button, and either the `NewProjectForm`, `PaneLayout` (when a project is selected), or default `Terminal` view
- `LoginScreen` — Token input form with submit button; calls `onLogin` callback with the entered token
- `NewProjectForm` — Project creation form with name and directory path inputs (path pre-filled with `~/`); submits to `POST /api/projects` with Bearer token auth
- `PaneLayout` — Multi-pane layout that renders two Terminal instances side by side in a 50/50 split (CLI + Claude), each with a label header. Each terminal connects to a separate tmux window via grouped sessions.
- `Terminal` — xterm.js terminal that connects to the backend Socket.io `/terminal` namespace, with Solarized Dark theme and automatic resize. Accepts optional `pane` prop to connect to a specific tmux window.
- `main.jsx` — Entry point, mounts React to `#root`

## Relation to other modules

- **server/** — Backend API and WebSocket layer. The client proxies to it during development and is served by it in production.
