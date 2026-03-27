# DanCode

Web-based project terminal manager. Provides browser-based terminal access with direct PTY spawning, letting you manage multiple coding projects from any device on your network.

Built for Raspberry Pi 5, accessed via Tailscale.

## Tech Stack

- **Backend:** Node.js + Express + Socket.io
- **Frontend:** React + Vite + Tailwind CSS
- **Terminal:** xterm.js + node-pty (direct PTY via TerminalManager)
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
- **Direct PTY terminals** — TerminalManager spawns shells directly via node-pty, with per-terminal WebSocket namespace, ~50KB output ring buffer for reconnection replay, and metadata persistence
- **Reconnection UX** — Auto-reconnects on disconnect with "Reconnecting..." overlay, 30-second timeout to "Disconnected" with manual button; per-terminal connection state indicator dots (green/yellow/red)
- **Project creation** — Automatically creates 2 terminals (CLI + Claude) per project
- **Drag-and-drop image upload** — Drop images onto a terminal to upload and inject the file path
- **Clipboard support** over plain HTTP — Ctrl+C copies selected text, Ctrl+V pastes (uses `execCommand` fallback for non-HTTPS)
- **Focused pane indicator** — 8px blue accent bar + dimmed unfocused panes
- **Right-click context menu** on sidebar projects — Rename, Delete
- **Keyboard shortcuts** — Ctrl+K command palette, Alt+arrows project switching, Ctrl+wheel font sizing
- **Mobile terminal** — Full-screen read-first terminal on mobile (<1024px) with thin top bar, keyboard toggle, and horizontal shortcut bar (Ctrl+C/V/D, Tab, arrows, Esc) with 44px tap targets
- **Mobile dashboard** — Project card grid with long-press quick actions (open CLI/Claude terminal)
- **Pinch-to-zoom** — Touch gesture for terminal font size on mobile
- **Tablet support** — Optional side-by-side terminals (768-1024px) with shortcut bar toggle
- **TOTP authentication** — Username/password + TOTP-based login with QR code setup

## Development

```bash
npm run dev          # Server (watch) + Client (HMR) concurrently
npm run build        # Production build (client)
npm test             # Run unit tests (Vitest)
npm run test:e2e     # Run E2E tests (Playwright)
```
