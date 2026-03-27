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

- `App` — Root component, checks localStorage for auth token; shows `LoginScreen` if absent, otherwise renders the header with "New Project" button, a left sidebar listing projects, and either the `NewProjectForm` or `TerminalLayout` (when a project is selected). Ctrl+K opens the command palette for project switching.
- `CommandPalette` — Centered overlay with fuzzy-search input for switching between projects. Exports `fuzzyMatch` for reuse. Props: `open`, `onClose`, `projects`, `currentSlug`, `onSelect`.
- `Sidebar` — Left sidebar listing all projects by name with the active project visually highlighted. Props: `projects`, `currentSlug`, `onSelect`.
- `LoginScreen` — Username/password + TOTP login form; calls `onLogin` callback with the session token
- `NewProjectForm` — Project creation form with name and directory path inputs (path pre-filled with `~/`); submits to `POST /api/projects` with Bearer token auth
- `TerminalLayout` — Multi-terminal layout rendering Terminal instances side by side (split) or in tabs. Supports dynamic terminal creation (+), close with confirmation, inline rename (double-click label), and persists layout mode + terminal order to the project config via `PATCH /api/projects/:slug`. Responsive: auto-switches to tabs on mobile (<768px).
- `Terminal` — xterm.js terminal that connects to the backend Socket.io `/terminal/{uuid}` namespace, with Solarized Dark theme and automatic resize. Accepts `terminalId` prop. Shows a reconnect button on WebSocket disconnection and an informational overlay when the PTY exits.
- `main.jsx` — Entry point, mounts React to `#root`

## Relation to other modules

- **server/** — Backend API and WebSocket layer. The client proxies to it during development and is served by it in production.
