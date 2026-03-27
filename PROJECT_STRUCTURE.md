# Project Structure

```
DanCode/
├── client/                     # React + Vite + Tailwind frontend
│   ├── public/                 # Static assets (PWA manifest, icons, service worker)
│   │   ├── manifest.json       # PWA manifest: app name, theme color, standalone display, icons
│   │   ├── icon-192.svg        # PWA icon 192x192 (SVG, Solarized Dark with "D" monogram)
│   │   ├── icon-512.svg        # PWA icon 512x512 (SVG, maskable)
│   │   └── sw.js               # Service worker: caches app shell, network-first for navigation
│   ├── src/
│   │   ├── App.jsx             # Root React component (auth gate, mobile/desktop routing, project form, command palette, sidebar, file explorer, terminal activity)
│   │   ├── App.test.jsx        # App unit tests (login/terminal/mobile/command-palette/sidebar/header-dropdown rendering)
│   │   ├── CommandPalette.jsx  # Command palette overlay with fuzzy search for project switching (Ctrl+K)
│   │   ├── FileExplorer.jsx   # Collapsible file explorer panel: lazy-loaded tree view, context menu, drag-to-terminal, .gitignore/.hidden toggles
│   │   ├── FileExplorer.test.jsx # FileExplorer unit tests (tree view, context menu, toggles, drag, expand)
│   │   ├── CommandPalette.test.jsx # CommandPalette unit tests (fuzzy match, filtering, open/close, selection)
│   │   ├── LoginScreen.jsx     # Username/password + TOTP login form
│   │   ├── LoginScreen.test.jsx # LoginScreen component unit tests
│   │   ├── MobileDashboard.jsx # Mobile project card grid with activity indicators, terminal labels, pull-to-refresh, long-press quick actions
│   │   ├── MobileDashboard.test.jsx # MobileDashboard unit tests (cards, selection, quick actions, activity indicators)
│   │   ├── MobileTerminalList.jsx # Mobile terminal list for selected project with activity indicators and back navigation
│   │   ├── MobileTerminalList.test.jsx # MobileTerminalList unit tests (terminal items, activity, back, selection)
│   │   ├── MobileTerminalView.jsx # Full-screen mobile terminal: read-first, keyboard toggle, shortcut bar, swipe nav, dot indicators, project drawer
│   │   ├── MobileTerminalView.test.jsx # MobileTerminalView unit tests (read-first, back, tabs, dots, drawer)
│   │   ├── NewProjectForm.jsx  # New project creation form (name + path inputs, calls POST /api/projects)
│   │   ├── NewProjectForm.test.jsx # NewProjectForm component unit tests
│   │   ├── ShortcutBar.jsx     # Horizontal scrolling shortcut bar (Ctrl+C/V/D, Tab, arrows, Esc) with 44px tap targets
│   │   ├── ShortcutBar.test.jsx # ShortcutBar unit tests (key sequences, tap targets)
│   │   ├── TerminalLayout.jsx  # Multi-terminal layout: split/tabbed view, tablet shortcut bar toggle, file drop support
│   │   ├── TerminalLayout.test.jsx # TerminalLayout component unit tests
│   │   ├── Sidebar.jsx         # Collapsible left sidebar listing all projects by name with active highlight
│   │   ├── Sidebar.test.jsx    # Sidebar component unit tests
│   │   ├── Terminal.jsx        # xterm.js terminal with forwardRef, pinch-to-zoom, readFirst mode
│   │   ├── Terminal.test.jsx   # Terminal component unit tests
│   │   ├── poc-terminal.js     # POC: standalone xterm.js page for new terminal API (E2E testing)
│   │   ├── index.css           # Tailwind + Solarized Dark theme
│   │   └── main.jsx            # Entry point
│   ├── index.html              # HTML shell with PWA manifest link, theme-color meta, service worker registration
│   ├── poc-terminal.html       # POC: HTML entry point for standalone terminal page
│   ├── vite.config.js          # Vite config (proxy, Tailwind plugin)
│   ├── package.json            # Includes vitest test scripts
│   └── README.md
├── docs/
│   └── PRD.md                  # Product requirements document
├── plans/
│   ├── dancode-mvp.md          # MVP implementation plan
│   └── dancode-future-phases.md
├── server/                     # Express + Socket.io backend
│   ├── src/
│   │   ├── auth.js             # TOTP-based auth: account setup, login, session management (~/.dancode/credentials.json)
│   │   ├── files.js            # File system API: list, read, write, mkdir, rename, delete with path traversal protection
│   │   ├── index.js            # Server entry point (Express, Socket.io, REST API routes, terminal CRUD, file API)
│   │   ├── projects.js         # Project config CRUD (create, list, get, delete) in ~/.dancode/projects/
│   │   ├── terminal-manager.js # TerminalManager: tmux-backed PTY spawning, CRUD, ring buffer, reconcile, WebSocket /terminal/{uuid}, lastActivity tracking
│   │   ├── terminal.js         # (Legacy, emptied) Socket.io /terminal namespace
│   │   └── tmux.js             # Tmux utility: create/kill/query sessions, capture pane, resize, send keys
│   ├── tests/
│   │   ├── e2e/
│   │   │   ├── fixture.js      # Playwright + Midscene.js AI fixture (provides aiAssert, etc.)
│   │   │   ├── placeholder.spec.js  # Playwright E2E test (server placeholder page)
│   │   │   ├── e2e-helpers.js         # Shared helpers: login (TOTP), createProject, cleanupProject
│   │   │   ├── auth.spec.js          # Playwright E2E test (login flow)
│   │   │   ├── auth-visual.spec.js   # Visual assertion: login form on dark background
│   │   │   ├── terminal.spec.js     # Playwright E2E test (xterm.js terminal visibility)
│   │   │   ├── terminal-visual.spec.js  # Visual assertion: Solarized Dark theme + fills viewport
│   │   │   ├── terminal-lifecycle.spec.js # E2E test: create/add/rename/close terminals, split/tabs modes
│   │   │   ├── terminal-poc.spec.js     # Playwright E2E test (create terminal via API, type in xterm, see output)
│   │   │   ├── new-project.spec.js    # Playwright E2E test (new project creation → terminal layout)
│   │   │   ├── new-project-visual.spec.js  # Visual assertion: new project form on dark background
│   │   │   ├── adopt-session.spec.js  # Placeholder (adopt flow removed in Phase 2)
│   │   │   ├── layout.spec.js        # Playwright E2E test (multi-terminal layout: split/tabs, close with confirm)
│   │   │   ├── layout-visual.spec.js # Visual assertion: two panes side by side with labels
│   │   │   ├── command-palette.spec.js  # Playwright E2E test (Ctrl+K palette, search, switch project)
│   │   │   ├── command-palette-visual.spec.js  # Visual assertion: palette overlay centered
│   │   │   ├── sidebar.spec.js          # Playwright E2E test (sidebar project switching)
│   │   │   ├── sidebar-visual.spec.js   # Visual assertion: sidebar with project list and active highlight
│   │   │   ├── header-dropdown.spec.js  # Playwright E2E test (header dropdown project switching)
│   │   │   ├── reconnection.spec.js   # Playwright E2E test (disconnect/reconnect overlay, buffer replay, state indicators)
│   │   │   ├── tmux-persistence.spec.js # Playwright E2E test (tmux persistence: server restart, reconnect, scrollback replay)
│   │   │   ├── mobile-terminal.spec.js # Playwright mobile emulation E2E (iPhone 12 viewport, read-first, shortcut bar, Ctrl+C)
│   │   │   ├── file-explorer.spec.js # Playwright E2E test (expand dirs, create/rename/delete files, drag to terminal)
│   │   │   ├── mobile-pwa.spec.js    # Playwright mobile emulation E2E (Pixel 5 viewport, PWA, dashboard nav, dots, swipe)
│   │   │   └── visual.spec.js  # Midscene AI visual assertion test (DOM-based on Pi 5)
│   │   ├── files.test.js       # File API unit tests (CRUD, path traversal rejection, gitignore filtering)
│   │   ├── auth.test.js        # Auth account setup, login, session management tests
│   │   ├── projects.test.js    # Project config CRUD, slug generation, validation tests
│   │   ├── server.test.js      # Server unit tests (routes, auth middleware, project API)
│   │   ├── terminal.test.js    # Socket.io /terminal namespace lifecycle tests (legacy, preserved)
│   │   ├── terminal-manager.test.js  # TerminalManager integration tests (CRUD, metadata, WebSocket, reconnection, auth, tmux persistence, reconcile)
│   │   └── tmux.test.js        # Tmux utility module tests (session lifecycle, capture, resize, list)
│   ├── .env                    # Midscene.js config (git-ignored): Ollama endpoint, model settings
│   ├── package.json
│   ├── playwright.config.js    # Playwright config (Midscene reporter, system Chromium, webServer on :3001)
│   ├── vitest.config.js        # Vitest config (excludes e2e tests)
│   └── README.md
├── package.json                # Root workspace config + top-level scripts
├── PROJECT_STRUCTURE.md        # This file
└── README.md                   # Project overview
```

## Module boundaries

- **server/** — HTTP server and WebSocket layer. Serves the frontend build and handles all backend API/socket communication. See [server/README.md](server/README.md).
- **client/** — React + Vite + Tailwind CSS frontend. Dev server on port 5173 proxies API/WebSocket to the backend. See [client/README.md](client/README.md).
