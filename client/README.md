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

- `App` — Root component, checks localStorage for auth token; shows `LoginScreen` if absent, otherwise renders the Terminal view
- `LoginScreen` — Token input form with submit button; calls `onLogin` callback with the entered token
- `Terminal` — xterm.js terminal that connects to the backend Socket.io `/terminal` namespace, with Solarized Dark theme and automatic resize
- `main.jsx` — Entry point, mounts React to `#root`

## Relation to other modules

- **server/** — Backend API and WebSocket layer. The client proxies to it during development and is served by it in production.
