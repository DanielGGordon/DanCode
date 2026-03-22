# DanCode

Web-based project terminal manager. Presents a browser-based view of tmux sessions, letting you manage multiple coding projects from any device on your network.

Built for Raspberry Pi 5, accessed via Tailscale.

## Tech Stack

- **Backend:** Node.js + Express + Socket.io
- **Frontend:** React + Vite + Tailwind CSS (planned)
- **Terminal:** xterm.js + node-pty + tmux (planned)
- **Theme:** Solarized Dark (#002b36)
- **Testing:** Vitest + Playwright + Midscene.js

## Project Structure

See [PROJECT_STRUCTURE.md](PROJECT_STRUCTURE.md) for the full file tree.

## Getting Started

```bash
cd server && npm install && npm start
```

Opens on http://localhost:3000

## Development

```bash
cd server && npm run dev    # Backend with file watching
cd server && npm test       # Run unit tests
```
