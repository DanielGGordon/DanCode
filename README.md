# DanCode

Web-based project terminal manager. Provides browser-based terminal access with direct PTY spawning, letting you manage multiple coding projects from any device on your network.

Built for Raspberry Pi 5, accessed via Tailscale.

## Tech Stack

- **Backend:** Node.js + Express + Socket.io
- **Frontend:** React + Vite + Tailwind CSS
- **Terminal:** xterm.js + node-pty + tmux (PTY inside invisible tmux sessions via TerminalManager)
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

- **Multi-terminal layout** — Split (side-by-side) or tabbed view with dynamic terminal creation, close, and rename
- **Tmux-backed terminals** — TerminalManager spawns shells inside invisible tmux sessions (`dancode-{slug}-{id}`), with per-terminal WebSocket namespace, ~50KB output ring buffer for reconnection replay, and metadata persistence. Processes survive server restarts; `tmux attach` from the host connects to the same terminal
- **Server restart recovery** — On startup, reconciles tmux sessions with terminal metadata: reattaches orphaned sessions, repopulates ring buffers from tmux scrollback, and cleans up stale metadata
- **Reconnection UX** — Auto-reconnects on disconnect with "Reconnecting..." overlay, 30-second timeout to "Disconnected" with manual button; per-terminal connection state indicator dots (green/yellow/red)
- **Project creation** — Automatically creates 2 terminals (CLI + Claude) per project
- **Drag-and-drop image upload** — Drop images onto a terminal to upload and inject the file path
- **Clipboard image paste** — Ctrl+V a screenshot into a terminal to upload and inject the file path (for sending images to Claude)
- **Clipboard support** over plain HTTP — Ctrl+C copies selected text, Ctrl+V pastes (uses `execCommand` fallback for non-HTTPS)
- **Focused pane indicator** — 8px blue accent bar + dimmed unfocused panes
- **Right-click context menu** on sidebar projects — Rename, Delete
- **Keyboard shortcuts** — Ctrl+K command palette, Alt+arrows project switching, Ctrl+wheel font sizing
- **PWA installable** — manifest.json with DanCode branding, Solarized Dark theme color (#002b36), standalone display; service worker caches app shell for offline-capable fast loading; installable on Android home screen
- **Mobile terminal** — Full-screen read-first terminal on mobile (<1024px) with thin top bar, keyboard toggle, and horizontal shortcut bar (Ctrl+C/V/D, Tab, arrows, Esc) with 44px tap targets
- **Mobile dashboard** — Project card grid with activity indicators (active/idle), terminal labels, last activity timestamps, pull-to-refresh, and long-press quick actions (open CLI/Claude terminal)
- **Mobile navigation** — Three-level flow: dashboard → terminal list → full-screen terminal, with back button at each level
- **Swipe gestures** — Swipe left/right between terminals with dot pagination indicators; swipe from left edge opens project drawer
- **Pinch-to-zoom** — Touch gesture for terminal font size on mobile
- **Tablet support** — Optional side-by-side terminals (768-1024px) with shortcut bar toggle
- **File explorer** — Collapsible tree-view panel with lazy-loaded directories, file type icons, right-click context menu (rename, delete, copy path, new file, new folder, open terminal here, open in viewer), drag files onto terminals to insert paths, .gitignore filtering with toggle, hidden file toggle
- **File viewer** — Click a file in the explorer to open it as a pane alongside terminals with syntax highlighting (18 languages via highlight.js), line numbers, edit/save mode (Ctrl+S), Solarized Dark theme; mixed terminal + file panes share the same split/tab/resize layout
- **TOTP authentication** — Username/password + TOTP-based login with QR code setup; sessions persist across server restarts with 30-day TTL, automatic expiry cleanup on startup and hourly, async debounced disk writes
- **Response optimization** — Gzip compression on all HTTP responses; Vite-hashed static assets cached immutably for 1 year, `index.html` served with `no-cache` for instant updates
- **Server I/O optimization** — Gitignore rules cached per project root with 30-second TTL; terminal ring buffer uses array-of-chunks internally to reduce GC pressure

## Development

```bash
npm run dev          # Server (watch) + Client (HMR) concurrently
npm run build        # Production build (client)
npm test             # Run unit tests (Vitest)
npm run test:e2e     # Run E2E tests (Playwright)
```
