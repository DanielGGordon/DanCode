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

- `App` — Root component. Detects mobile (<1024px) vs desktop. On desktop: header, sidebar, command palette, TerminalLayout. On mobile: MobileDashboard or MobileTerminalView. Ctrl+K opens command palette for project switching.
- `CommandPalette` — Centered overlay with fuzzy-search input for switching between projects. Exports `fuzzyMatch` for reuse. Props: `open`, `onClose`, `projects`, `currentSlug`, `onSelect`.
- `Sidebar` — Left sidebar listing all projects by name with the active project visually highlighted. Props: `projects`, `currentSlug`, `onSelect`.
- `LoginScreen` — Username/password + TOTP login form; calls `onLogin` callback with the session token
- `NewProjectForm` — Project creation form with name and directory path inputs (path pre-filled with `~/`); submits to `POST /api/projects` with Bearer token auth
- `MobileDashboard` — Project card grid for mobile devices. Shows activity indicators (green=active, gray=idle), terminal labels, last activity timestamps. Pull-to-refresh updates activity. Tap to select, long-press (500ms) for quick actions (Open CLI Terminal, Open Claude Terminal). Props: `projects`, `projectTerminals`, `onSelectProject`, `onQuickAction`, `onNewProject`, `onLogout`, `onRefresh`.
- `MobileTerminalList` — Terminal list for selected project. Shows activity indicators and last activity time per terminal. Back button returns to dashboard. Props: `projectName`, `terminals`, `onSelectTerminal`, `onBack`.
- `MobileTerminalView` — Full-screen mobile terminal. Read-first design (keyboard hidden by default). Thin top bar with back button and terminal label. Keyboard toggle button to enter input mode. ShortcutBar appears when in input mode. Swipe left/right between terminals, dot pagination indicators, project drawer (swipe from left edge). Supports tab switching for multiple terminals. Props: `token`, `terminal`, `projectSlug`, `onBack`, `terminals`, `onSwitchTerminal`, `projects`, `onSwitchProject`.
- `ShortcutBar` — Horizontal scrolling bar of terminal key shortcuts (Ctrl+C, Ctrl+V, Ctrl+D, Tab, Up, Down, Esc). Each button is a 44px minimum tap target. Props: `onSend`, `onPaste`.
- `FileExplorer` — Collapsible file explorer panel alongside terminals. Lazy-loaded directory tree with file type icons, right-click context menu (rename, delete, copy path, new file, new folder, open terminal here), drag files onto terminals to insert paths, .gitignore pattern filtering with toggle, hidden file toggle. Props: `token`, `slug`, `collapsed`, `onToggle`, `onOpenTerminalHere`, `onInsertPath`.
- `TerminalLayout` — Multi-terminal layout: split (side-by-side) or tabbed view. Supports terminal creation, close, rename. Persists layout via `PATCH /api/projects/:slug`. Responsive: auto-switches to tabs on mobile (<768px). Tablet (768-1024px): optional shortcut bar toggle. Accepts file drops from FileExplorer. Exposes `addTerminalWithCwd` and `insertIntoFocusedTerminal` via ref.
- `Terminal` — xterm.js terminal with forwardRef. Connects via Socket.io `/terminal/{uuid}`. Solarized Dark theme, auto-resize, reconnection UX, drag-and-drop upload. Supports `readFirst` prop (no auto-focus), pinch-to-zoom on mobile, and imperative API via ref (`sendInput`, `focus`, `setFontSize`, `getFontSize`). Props: `token`, `terminalId`, `projectSlug`, `focused`, `readFirst`, `onFocus`, `onConnectionStateChange`.
- `main.jsx` — Entry point, mounts React to `#root`

## Relation to other modules

- **server/** — Backend API and WebSocket layer. The client proxies to it during development and is served by it in production.
