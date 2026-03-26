# Project Structure

```
DanCode/
├── client/                     # React + Vite + Tailwind frontend
│   ├── public/                 # Static assets
│   ├── src/
│   │   ├── App.jsx             # Root React component (auth gate, project form toggle, terminal view, command palette, sidebar, header project dropdown)
│   │   ├── App.test.jsx        # App unit tests (login/terminal/new-project/command-palette/sidebar/header-dropdown conditional rendering)
│   │   ├── CommandPalette.jsx  # Command palette overlay with fuzzy search for project switching (Ctrl+K)
│   │   ├── CommandPalette.test.jsx # CommandPalette unit tests (fuzzy match, filtering, open/close, selection)
│   │   ├── LoginScreen.jsx     # Token input form with submit button
│   │   ├── LoginScreen.test.jsx # LoginScreen component unit tests
│   │   ├── NewProjectForm.jsx  # New project creation form (name + path inputs, adopt-session toggle, calls POST /api/projects)
│   │   ├── NewProjectForm.test.jsx # NewProjectForm component unit tests
│   │   ├── PaneLayout.jsx      # Multi-pane layout: split view (side-by-side) or tabbed view with toggle
│   │   ├── PaneLayout.test.jsx # PaneLayout component unit tests
│   │   ├── Sidebar.jsx         # Collapsible left sidebar listing all projects by name with active highlight and tmux status dot
│   │   ├── Sidebar.test.jsx    # Sidebar component unit tests
│   │   ├── Terminal.jsx        # xterm.js terminal connected via Socket.io (supports per-pane connections)
│   │   ├── Terminal.test.jsx   # Terminal component unit tests
│   │   ├── poc-terminal.js     # POC: standalone xterm.js page for new terminal API (E2E testing)
│   │   ├── index.css           # Tailwind + Solarized Dark theme
│   │   └── main.jsx            # Entry point
│   ├── index.html              # HTML shell
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
│   │   ├── index.js            # Server entry point (Express, Socket.io, REST API routes, terminal CRUD)
│   │   ├── projects.js         # Project config CRUD (create, list, get, delete) in ~/.dancode/projects/
│   │   ├── terminal.js         # Socket.io /terminal namespace (node-pty → tmux attach, legacy path)
│   │   ├── terminal-manager.js # TerminalManager: direct PTY spawning, CRUD, ring buffer, WebSocket /terminal/{uuid}
│   │   └── tmux.js             # Tmux session management (ensure, create, check)
│   ├── tests/
│   │   ├── e2e/
│   │   │   ├── fixture.js      # Playwright + Midscene.js AI fixture (provides aiAssert, etc.)
│   │   │   ├── placeholder.spec.js  # Playwright E2E test (server placeholder page)
│   │   │   ├── auth.spec.js          # Playwright E2E test (login flow: login screen → enter token → terminal appears)
│   │   │   ├── auth-visual.spec.js   # Midscene AI visual assertion test (login form on dark background)
│   │   │   ├── terminal.spec.js     # Playwright E2E test (xterm.js terminal visibility)
│   │   │   ├── terminal-visual.spec.js  # Visual assertion: Solarized Dark theme + fills viewport (screenshot pixel analysis)
│   │   │   ├── new-project.spec.js    # Playwright E2E test (new project creation flow: form → submit → terminal panes)
│   │   │   ├── new-project-visual.spec.js  # Midscene AI visual assertion test (new project form on dark background)
│   │   │   ├── adopt-session.spec.js  # Playwright E2E test (adopt existing tmux session: create session, adopt via form, verify panes)
│   │   │   ├── layout.spec.js        # Playwright E2E test (multi-pane layout: split/tabs, mobile viewport, pane visibility)
│   │   │   ├── layout-visual.spec.js # Midscene AI visual assertion test (two panes side by side with labels)
│   │   │   ├── command-palette.spec.js  # Playwright E2E test (Ctrl+K opens palette, search, switch project, terminals update)
│   │   │   ├── command-palette-visual.spec.js  # Midscene AI visual assertion test (palette overlay centered with search input and project list)
│   │   │   ├── sidebar.spec.js          # Playwright E2E test (sidebar project switching: click project, terminals update)
│   │   │   ├── sidebar-visual.spec.js   # Midscene AI visual assertion test (collapsible sidebar with project list and active highlight)
│   │   │   ├── header-dropdown.spec.js  # Playwright E2E test (header dropdown: click project name, dropdown appears, select project, terminals switch)
│   │   │   ├── terminal-poc.spec.js     # Playwright E2E test (create terminal via API, type in xterm, see output)
│   │   │   └── visual.spec.js  # Midscene AI visual assertion test (DOM-based on Pi 5)
│   │   ├── auth.test.js        # Auth account setup, login, session management tests
│   │   ├── projects.test.js    # Project config CRUD, slug generation, validation tests
│   │   ├── server.test.js      # Server unit tests (routes, auth middleware, project API)
│   │   ├── terminal.test.js    # Socket.io /terminal namespace lifecycle tests (legacy tmux path)
│   │   ├── terminal-manager.test.js  # TerminalManager integration tests (CRUD, metadata, WebSocket, reconnection, auth)
│   │   └── tmux.test.js        # Tmux session management tests
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
