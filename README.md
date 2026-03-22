# DanCode

Web-based project terminal manager. Presents a browser-based view of tmux sessions, letting you manage multiple coding projects from any device on your network.

Built for Raspberry Pi 5, accessed via Tailscale.

## Tech Stack

- **Backend:** Node.js + Express + Socket.io
- **Frontend:** React + Vite + Tailwind CSS
- **Terminal:** xterm.js + node-pty + tmux (planned)
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

## Development

```bash
npm run dev          # Server (watch) + Client (HMR) concurrently
npm run build        # Production build (client)
npm test             # Run unit tests (server)
```
