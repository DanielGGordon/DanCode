# DanCode

Web-based project terminal manager. Presents a browser-based view of tmux sessions, letting you manage multiple coding projects from any device on your network.

Built for Raspberry Pi 5, accessed via Tailscale.

## Tech Stack

- **Backend:** Node.js + Express + Socket.io
- **Frontend:** React + Vite + Tailwind CSS
- **Terminal:** xterm.js + node-pty (direct PTY or tmux-backed)
- **Theme:** Solarized Dark (#002b36)
- **Testing:** Vitest + Playwright + Midscene.js

## Project Structure

See [PROJECT_STRUCTURE.md](PROJECT_STRUCTURE.md) for the full file tree.

## Prerequisites

- **Node.js** `^20.19.0 || >=22.12.0` (required by Vite 8; use `nvm install` to pick up the `.nvmrc`)

## Getting Started

```bash
npm install          # Install all workspace dependencies
npm run dev          # Start server + client concurrently
```

## Features

- **Multi-pane split view** of tmux windows (CLI, Claude, etc.) in the browser
- **Clipboard support** over plain HTTP — Ctrl+C copies selected text, Ctrl+V pastes (uses `execCommand` fallback for non-HTTPS)
- **Focused pane indicator** — 8px blue accent bar + dimmed unfocused panes
- **Right-click context menu** on sidebar projects — Rename, Copy tmux command, Delete
- **Tmux session naming** — sessions use human-readable names (no `dancode-` prefix), renameable from the UI
- **Stale session cleanup** — orphaned connection sessions are automatically cleaned up on server startup
- **Keyboard shortcuts** — Ctrl+K command palette, Alt+arrows project switching, Ctrl+wheel font sizing
- **Direct PTY terminals** — New terminal API spawns shells directly (no tmux), with WebSocket per terminal, ~50KB output ring buffer for reconnection replay, and metadata persistence

## Development

```bash
npm run dev          # Server (watch) + Client (HMR) concurrently
npm run build        # Production build (client)
npm test             # Run unit tests (Vitest)
npm run test:e2e     # Run E2E tests (Playwright)
```
