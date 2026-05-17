# Project Structure

```
DanCode/
├── bin/
│   └── check-setup.mjs         # `npm run check:setup` preflight (Node version, build deps, socket-dir writability)
├── shellhost/                  # Phase 1+: standalone PTY-owning Node process (dancode-shellhost)
│   ├── bin/dancode-shellhost.js # CLI entry alias
│   ├── src/
│   │   ├── index.js            # Entry: starts a server on ~/.dancode/shellhost.sock with disk-backed scrollback under ~/.dancode/terminals/; drops a pidfile so an orchestrator can SIGKILL it (Phase 5)
│   │   ├── server.js           # UNIX-socket server + op dispatch (spawn/attach/detach/write/resize/kill/list/inspect/getScrollback/respawn/noteClaudeSession)
│   │   ├── pty-manager.js      # Owns the in-memory map of live + needs-respawn PTYs; appends PTY output to scrollback write-through; respawn() persists yellow banner + spawns at saved cwd/command. Phase 7: rewrites `claude` → `claude --resume <id>` when meta.claudeSessionId is set; exposes getTty/setClaudeActive/setClaudeSessionId
│   │   ├── scrollback.js       # Phase 2: ScrollbackStore — append-only `<baseDir>/<id>/scrollback.log` with 1MB rotation + tail read
│   │   ├── meta-store.js       # Phase 5: MetaStore — atomic per-terminal `<baseDir>/<id>/meta.json` (write/update/read/list/remove) used to reconstruct terminals on shellhost restart
│   │   ├── claude-detector.js  # Phase 7: ClaudeDetector — periodic (5s) inspector that runs `ps` on each PTY's tty, flips claudeActive, persists ~/.claude/projects/<slug>/<newest>.jsonl id to meta.claudeSessionId. Helpers: parsePsForegroundOutput / isClaudeProcess / findNewestClaudeSession / isClaudeCommand / buildClaudeResumeCommand
│   │   ├── client.js           # Client library used by dancode-server to call shellhost
│   │   └── wire.js             # Length-prefixed JSON frame codec (encode/decode/streaming framer)
│   ├── tests/
│   │   ├── wire.test.js        # Frame codec unit tests
│   │   ├── pty-manager.test.js # PTYManager unit tests (fake spawn)
│   │   ├── ops.test.js         # Per-op dispatch unit tests
│   │   ├── scrollback.test.js  # ScrollbackStore unit tests (append, rotate, readTail, disk-usage)
│   │   ├── scrollback-ops.test.js # Wire-op tests for scrollback replay on attach
│   │   ├── meta-store.test.js  # Phase 5: MetaStore unit tests (atomic write, read, list, remove, malformed-file skip)
│   │   ├── respawn.test.js     # Phase 5: PTYManager loadOrphans/respawn unit tests; periodic lastActiveAt flush
│   │   ├── respawn-integration.test.js # Phase 5: spawn → write sentinel → SIGKILL shellhost → fresh shellhost on same socket → respawn → assert new PID, banner emitted, scrollback + cwd preserved
│   │   ├── claude-detector.test.js # Phase 7: detector unit tests (ps-output parse, isClaudeProcess, findNewestClaudeSession, tick logic with mocked ps, start/stop)
│   │   ├── claude-respawn.test.js  # Phase 7: PTYManager getTty/setClaudeSessionId + respawn rewrites `claude` → `claude --resume <id>`; isClaudeCommand/buildClaudeResumeCommand unit tests
│   │   ├── note-claude-session-op.test.js # Phase 7: wire-op noteClaudeSession writes claudeSessionId atomically to meta.json (live + needs-respawn terminals)
│   │   ├── claude-integration.test.js # Phase 7: full flow — fake-claude PTY → meta.claudeSessionId within 10s → SIGKILL shellhost → restart → /proc/<pid>/cmdline of respawn includes `claude --resume <id>`
│   │   ├── claude-cpu-budget.test.js # Phase 7: 5 active Claude-detection terminals × 60s, /proc/<shellhost-pid>/stat utime+stime delta < 600ms (< 1% sustained)
│   │   ├── claude-no-false-positive.test.js # Phase 7: 5 idle bash PTYs × ~10 min equivalent (50ms interval × 120 ticks), assert no terminal flagged Claude-active
│   │   ├── fixtures/fake-claude.mjs # Phase 7: tiny stand-in for the real `claude` binary; sets process.title=claude, touches a session jsonl, sleeps until killed
│   │   └── integration.test.js # Boots a real shellhost on a temp socket; in-process 2.5MB disk-usage test
│   ├── package.json
│   ├── vitest.config.js
│   └── README.md
├── client/                     # React + Vite + Tailwind frontend
│   ├── public/                 # Static assets (PWA manifest, icons, service worker)
│   │   ├── manifest.json       # PWA manifest: app name, theme color, standalone display, icons
│   │   ├── icon-192.svg        # PWA icon 192x192 (SVG, Solarized Dark with "D" monogram)
│   │   ├── icon-512.svg        # PWA icon 512x512 (SVG, maskable)
│   │   └── sw.js               # Service worker: caches app shell, network-first for navigation
│   ├── src/
│   │   ├── App.jsx             # Root React component (auth gate with React.lazy code splitting, mobile/desktop routing, project form, command palette, sidebar)
│   │   ├── App.test.jsx        # App unit tests (login/terminal/mobile/command-palette/sidebar/header-dropdown rendering)
│   │   ├── CommandPalette.jsx  # Command palette overlay with fuzzy search for project switching (Ctrl+K)
│   │   ├── FileExplorer.jsx   # Collapsible file explorer panel: lazy-loaded tree view, context menu, drag-to-terminal, click-to-view, .gitignore/.hidden toggles
│   │   ├── FileExplorer.test.jsx # FileExplorer unit tests (tree view, context menu, toggles, drag, expand)
│   │   ├── FileViewer.jsx     # File viewer pane: syntax highlighting (highlight.js dynamically imported, 18 languages), line numbers, edit/save mode, Solarized Dark theme
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
│   │   ├── TerminalLayout.jsx  # Multi-pane layout: mixed terminal + file viewer panes, split/tabbed view, resize, tablet shortcut bar
│   │   ├── TerminalLayout.test.jsx # TerminalLayout component unit tests
│   │   ├── Sidebar.jsx         # Collapsible left sidebar listing all projects by name with active highlight
│   │   ├── Sidebar.test.jsx    # Sidebar component unit tests
│   │   ├── ResizeHandle.jsx    # Drag-to-resize handle component for split pane layouts (vertical/horizontal)
│   │   ├── Terminal.jsx        # xterm.js terminal with forwardRef, pinch-to-zoom, readFirst mode, clipboard image paste (xterm dynamically imported)
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
│   ├── PRD.md                  # Product requirements document
│   └── layout-schema.md        # Phase 4: per-project layout.json schema (terminals, openFiles, splits, focusedPane)
├── plans/
│   ├── dancode-mvp.md          # MVP implementation plan
│   └── dancode-future-phases.md
├── server/                     # Express + Socket.io backend
│   ├── src/
│   │   ├── auth.js             # TOTP-based auth: account setup, login, session management (~/.dancode/credentials.json), persistent sessions (~/.dancode/sessions.json)
│   │   ├── files.js            # File system API: list, read, write, mkdir, rename, delete with path traversal protection
│   │   ├── index.js            # Server entry point (Express, Socket.io, REST API routes, terminal CRUD, file API)
│   │   ├── projects.js         # Project config CRUD (create, list, get, update, rename, delete) in ~/.dancode/projects/. Phase 4 renameProject moves slug + layout dir
│   │   ├── layout.js           # Phase 4: per-project layout persistence (defaultLayout, validateLayout, readLayout, writeLayout w/ atomic .tmp+fsync+rename, removeMissingFiles)
│   │   ├── terminal-manager.js # Legacy tmux-backed TerminalManager (fallback when DANCODE_SHELLHOST_SOCKET unset; removed in Phase 9)
│   │   ├── shellhost-terminal-manager.js # Phase 1+2: server-side adapter that fronts dancode-shellhost; replays disk scrollback to new sockets (no in-memory ring buffer)
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
│   │   ├── e2e-shellhost/
│   │   │   ├── boot-stack.mjs  # Spawns shellhost + supervises a dancode-server child process; respawns BOTH shellhost and server on death (Phase 3 + Phase 5 restart E2Es)
│   │   │   ├── global-teardown.js # Cleans up the temp E2E HOME after the run
│   │   │   ├── shellhost-terminal.spec.js # Phase 1: shellhost-backed terminal E2E (typed input + clipboard paste)
│   │   │   ├── scrollback-replay.spec.js  # Phase 2: disk-backed scrollback survives reload; no duplicate replay on double-reload
│   │   │   ├── server-restart.spec.js     # Phase 3: kill server mid-session → PTY survives, gap output replays, new input lands in same PTY
│   │   │   ├── layout-restore.spec.js     # Phase 4: 2 terminals (distinct cwds) + open file + vertical split survive logout/login
│   │   │   ├── missing-file-warning.spec.js # Phase 4: deleted file in layout shows banner; Close button removes it and updates layout.json
│   │   │   ├── shellhost-restart.spec.js  # Phase 5: SIGKILL shellhost via /test-only/restart-shellhost → reload → both terminals re-appear with prior-session banner + prior sentinel in DOM
│   │   │   └── resume-claude.spec.js  # Phase 7: sets a fake claudeSessionId via /api/test-only/note-claude-session → Resume Claude button visible → click → `claude --resume <id>` appears in xterm DOM; dismiss hides the button
│   │   ├── shellhost-integration.test.js # Phase 1+2: server <-> shellhost integration over UNIX socket (incl. disk replay on reconnect)
│   │   ├── claude-session-meta.test.js  # Phase 7: /api/terminals + /api/terminals/:id expose claudeSessionId (default null + after setClaudeSessionId)
│   │   ├── shellhost-restart.test.js     # Phase 3: ShellhostTerminalManager.recover() + startServer() list-based recovery; data-race stress (1MB output during restart cycle)
│   │   ├── layout.test.js      # Phase 4: layout module — defaultLayout, validateLayout, atomic writeLayout under concurrency, removeMissingFiles
│   │   ├── layout-api.test.js  # Phase 4: GET/PUT /api/projects/:slug/layout integration (20-parallel-PUT non-torn assertion, missingFiles annotation, schema rejection)
│   │   ├── project-rename.test.js # Phase 4: PATCH renames slug + moves layout dir; 409 on conflict; idempotent same-name rename
│   │   ├── files.test.js       # File API unit tests (CRUD, path traversal rejection, gitignore filtering, gitignore cache)
│   │   ├── ring-buffer.test.js # Legacy tmux-backend RingBuffer unit tests (removed from shellhost path in Phase 2)
│   │   ├── auth.test.js        # Auth account setup, login, session management tests
│   │   ├── projects.test.js    # Project config CRUD, slug generation, validation tests
│   │   ├── server.test.js      # Server unit tests (routes, auth middleware, project API)
│   │   ├── terminal.test.js    # Socket.io /terminal namespace lifecycle tests (legacy, preserved)
│   │   ├── terminal-manager.test.js  # TerminalManager integration tests (CRUD, metadata, WebSocket, reconnection, auth, tmux persistence, reconcile)
│   │   └── tmux.test.js        # Tmux utility module tests (session lifecycle, capture, resize, list)
│   ├── .env                    # Midscene.js config (git-ignored): Ollama endpoint, model settings
│   ├── package.json
│   ├── playwright.config.js    # Playwright config (Midscene reporter, system Chromium, webServer on :3001)
│   ├── playwright.shellhost.config.js # Playwright config for shellhost-backed E2E (temp HOME, workers:1)
│   ├── vitest.config.js        # Vitest config (excludes e2e tests)
│   └── README.md
├── package.json                # Root workspace config + top-level scripts
├── PROJECT_STRUCTURE.md        # This file
└── README.md                   # Project overview
```

## Module boundaries

- **server/** — HTTP server and WebSocket layer. Serves the frontend build and handles all backend API/socket communication. See [server/README.md](server/README.md).
- **client/** — React + Vite + Tailwind CSS frontend. Dev server on port 5173 proxies API/WebSocket to the backend. See [client/README.md](client/README.md).
