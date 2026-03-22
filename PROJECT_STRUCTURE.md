# Project Structure

```
DanCode/
├── client/                     # React + Vite + Tailwind frontend
│   ├── public/                 # Static assets
│   ├── src/
│   │   ├── App.jsx             # Root React component (auth gate, project form toggle, terminal view, command palette)
│   │   ├── App.test.jsx        # App unit tests (login/terminal/new-project/command-palette conditional rendering)
│   │   ├── CommandPalette.jsx  # Command palette overlay with fuzzy search for project switching (Ctrl+K)
│   │   ├── CommandPalette.test.jsx # CommandPalette unit tests (fuzzy match, filtering, open/close, selection)
│   │   ├── LoginScreen.jsx     # Token input form with submit button
│   │   ├── LoginScreen.test.jsx # LoginScreen component unit tests
│   │   ├── NewProjectForm.jsx  # New project creation form (name + path inputs, calls POST /api/projects)
│   │   ├── NewProjectForm.test.jsx # NewProjectForm component unit tests
│   │   ├── PaneLayout.jsx      # Multi-pane layout: split view (side-by-side) or tabbed view with toggle
│   │   ├── PaneLayout.test.jsx # PaneLayout component unit tests
│   │   ├── Terminal.jsx        # xterm.js terminal connected via Socket.io (supports per-pane connections)
│   │   ├── Terminal.test.jsx   # Terminal component unit tests
│   │   ├── index.css           # Tailwind + Solarized Dark theme
│   │   └── main.jsx            # Entry point
│   ├── index.html              # HTML shell
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
│   │   ├── auth.js             # Auth token generation and file management (~/.dancode/auth-token)
│   │   ├── index.js            # Server entry point (Express, Socket.io, REST API routes)
│   │   ├── projects.js         # Project config CRUD (create, list, get, delete) in ~/.dancode/projects/
│   │   ├── terminal.js         # Socket.io /terminal namespace (node-pty → tmux attach)
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
│   │   │   ├── layout.spec.js        # Playwright E2E test (multi-pane layout: split/tabs, mobile viewport, pane visibility)
│   │   │   ├── layout-visual.spec.js # Midscene AI visual assertion test (two panes side by side with labels)
│   │   │   └── visual.spec.js  # Midscene AI visual assertion test (DOM-based on Pi 5)
│   │   ├── auth.test.js        # Auth token generation and management tests
│   │   ├── projects.test.js    # Project config CRUD, slug generation, validation tests
│   │   ├── server.test.js      # Server unit tests (routes, auth middleware, project API)
│   │   ├── terminal.test.js    # Socket.io /terminal namespace lifecycle tests
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
