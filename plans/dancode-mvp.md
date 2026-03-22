# Plan: DanCode MVP — Web-Based Project Terminal Manager

> Source PRD: docs/PRD.md

## Architectural decisions

Durable decisions that apply across all phases:

- **Port**: `3000`
- **Config location**: `~/.dancode/`
- **Tmux session naming**: `dancode-<project-slug>` (slug = lowercase, hyphens, no spaces)
- **Auth token**: generated on first run, stored at `~/.dancode/auth-token`
- **REST routes**: `POST/GET/DELETE /api/projects`, `POST /api/auth/verify`, `GET /api/tmux/sessions`
- **Socket.io**: `/terminal` namespace for pane I/O, root namespace for project events
- **Terminal connection**: Socket.io ↔ node-pty ↔ `tmux attach -t <session>:<pane-index>`
- **Static serving**: Express serves Vite production build from `client/dist/`
- **Project structure**: `server/` (Express + Socket.io), `client/` (React + Vite)
- **Theme**: Solarized Dark only (#002b36 base background)
- **Default panes**: CLI (`cd <dir>`), Claude (`cd <dir> && claude --dangerously-skip-permissions`)

---

## Phase 0: Setup + Test Infrastructure

**User stories**: Foundation — no direct user story, enables all subsequent phases

### What to build

Scaffold the full project structure and install all dependencies so that subsequent phases can focus on features, not tooling. Set up the dev environment, build pipeline, and test infrastructure including local AI-powered visual testing.

### Acceptance criteria

- [x] `server/` directory with Express + Socket.io skeleton (starts, listens on port 3000, serves a "DanCode" placeholder page)
- [x] `client/` directory with React + Vite + Tailwind scaffold (builds, dev server proxies to backend)
- [x] Solarized Dark color palette defined as Tailwind theme extension
- [x] `package.json` at root with scripts: `dev`, `build`, `test`, `test:e2e`
- [x] Vitest configured with a passing placeholder unit test
- [x] Playwright configured with a passing placeholder E2E test (opens browser, sees placeholder page)
- [x] Ollama installed and running as a service (`curl http://localhost:11434/api/tags` returns 200)
- [x] Phi-3.5-Vision model pulled (`ollama pull phi3.5:3.8b-mini-instruct-q4_K_M`)
- [x] Midscene.js installed and configured to use local Ollama endpoint
- [x] One passing Midscene visual assertion: `aiAssert("a dark-themed page with the text DanCode is displayed")`
- [x] `~/.dancode/` directory created

---

## Phase 1: Tracer Bullet — One Terminal in Browser

**User stories**: "User opens browser and sees a working, interactive terminal"

### What to build

The thinnest possible end-to-end slice: a single xterm.js terminal in the browser connected to a tmux session via WebSocket. No auth, no projects, no config — just prove the core terminal-over-websocket architecture works. Apply Solarized Dark theme to xterm.js and the page.

### Acceptance criteria

- [x] Backend creates a tmux session (`dancode-test`) on startup if it doesn't exist
- [x] Socket.io `/terminal` namespace accepts connections and spawns node-pty attached to `tmux attach -t dancode-test`
- [x] Frontend renders a single xterm.js instance that fills the viewport
- [x] User can type commands in the browser terminal and see output (e.g., `ls`, `echo hello`)
- [x] xterm.js uses Solarized Dark color scheme
- [x] Page background, font, and spacing match the polished/modern design intent (subtle borders, not raw/unstyled)
- [x] Unit test: Socket.io connection lifecycle (connect, receive data, disconnect)
- [x] E2E test: Playwright opens page, xterm.js element is visible
- [x] Visual test: `aiAssert("a terminal with a dark solarized color scheme fills the browser window")`

---

## Phase 2: Auth Gate

**User stories**: "User must enter a token to access DanCode"

### What to build

Add token-based authentication. On first run, generate a random token and save it to `~/.dancode/auth-token`. The browser shows a login screen prompting for the token. Once entered, the token is stored in localStorage and sent with all subsequent requests. Unauthenticated requests are rejected.

### Acceptance criteria

- [x] On first server start, if `~/.dancode/auth-token` does not exist, generate a cryptographically random token and write it to the file
- [x] Token is logged to server console on first generation so the user can copy it
- [x] Frontend shows a login screen (token input + submit button) when no valid token is in localStorage
- [x] On successful auth, token is stored in localStorage and user sees the terminal view
- [x] Invalid token shows an error message, does not grant access
- [x] Socket.io connections include token in handshake auth — server middleware rejects invalid tokens
- [x] REST endpoints return 401 for missing/invalid tokens
- [x] Unit tests: token generation, token validation middleware, rejection of invalid tokens
- [x] E2E test: page shows login screen, enter token, terminal appears
- [x] Visual test: `aiAssert("a centered login form with a token input field on a dark background")`

---

## Phase 3: Project CRUD + Tmux Lifecycle

**User stories**: "User creates a project and DanCode sets up everything", "User deletes a project and config is removed but tmux stays"

### What to build

Project management: a REST API for creating, listing, and deleting projects. A "New Project" form in the UI. On creation, DanCode writes config to `~/.dancode/`, creates the project directory if needed, and spins up a tmux session with CLI + Claude panes. On deletion, config is removed but the tmux session is left alive. After creating a project, the UI switches to show that project's terminal panes.

### Acceptance criteria

- [x] `POST /api/projects` accepts `{ name, path }`, validates inputs, creates config in `~/.dancode/`
- [x] If the directory at `path` does not exist, create it
- [x] Creates tmux session `dancode-<slug>` with two panes: pane 0 runs `cd <path>`, pane 1 runs `cd <path> && claude --dangerously-skip-permissions`
- [x] `GET /api/projects` returns list of all configured projects
- [x] `DELETE /api/projects/:slug` removes project config but does NOT kill the tmux session
- [x] "New Project" button in the UI opens a form with project name and directory path (pre-filled with `~/`)
- [x] Submitting the form creates the project and switches to its terminal view (showing both panes)
- [x] Duplicate project names are rejected with a clear error message
- [x] Unit tests: config CRUD operations, tmux session creation, directory creation, slug generation
- [x] E2E test: click New Project, fill form, submit, see terminal panes for new project
- [x] Visual test: `aiAssert("a new project form is displayed with name and path input fields on a dark background")`

---

## Phase 4: Multi-Pane Layout

**User stories**: "User sees terminal panes side by side", "User can toggle to tabs", "Mobile shows tabs automatically", "User can show/hide individual panes"

### What to build

Display multiple xterm.js terminals for the active project's tmux panes. Desktop default is a responsive side-by-side split. Users can toggle to tabbed mode. Mobile viewports auto-switch to tabs. Individual panes can be toggled visible/hidden. Layout preferences are persisted to the project config.

### Acceptance criteria

- [x] Desktop (>768px): two panes display side by side in a 50/50 split by default
- [x] If a 3rd pane is enabled: panes display in a 33/33/33 split
- [x] Each pane has a label showing its type (CLI, Claude, Ralph)
- [x] Users can click a pane to focus it for keyboard input
- [x] Toggle button switches between split view and tabbed view on desktop
- [x] Mobile (<768px): automatically uses tabbed mode with tab buttons to switch panes
- [x] Pane visibility toggles: buttons to show/hide individual panes (at least one must remain visible)
- [x] Layout mode (split/tabs) and pane visibility are saved to the project config and restored on next visit
- [x] Hidden panes remain running in tmux — only the UI display is affected
- [x] Unit tests: layout state management, config persistence of layout preferences
- [ ] E2E test: verify split layout on desktop viewport, verify tabs on mobile viewport, toggle pane visibility
- [ ] Visual test: `aiAssert("two terminal panes are displayed side by side with labels, on a dark solarized background")`

---

## Phase 5: Project Switching — Command Palette

**User stories**: "User switches projects instantly via keyboard shortcut"

### What to build

A command palette overlay triggered by `Ctrl+K`. Shows a fuzzy-searchable list of all projects. Selecting a project disconnects current terminal sockets and connects to the selected project's panes. This is the default project switching mechanism.

### Acceptance criteria

- [ ] `Ctrl+K` opens a centered overlay with a text input for fuzzy search
- [ ] All projects are listed below the input, filtered in real-time as the user types
- [ ] Arrow keys navigate the list, Enter selects the highlighted project
- [ ] Escape or clicking outside closes the palette without switching
- [ ] Selecting a project: disconnects current pane sockets, connects to the new project's panes, updates the UI
- [ ] Current project is visually indicated (highlighted or marked) in the list
- [ ] Switching is fast — terminal content for the new project appears within 1-2 seconds
- [ ] If no projects exist, the palette shows a message prompting the user to create one
- [ ] Unit tests: fuzzy search filtering logic, project list ordering
- [ ] E2E test: Ctrl+K opens palette, type project name, enter switches, terminals update
- [ ] Visual test: `aiAssert("a command palette overlay is centered on the screen with a search input and a list of projects")`

---

## Phase 6: Project Switching — Sidebar

**User stories**: "User switches projects via a sidebar"

### What to build

A collapsible left sidebar listing all projects. Clicking a project switches to it. The sidebar shows project name and whether it has active tmux sessions. Can be toggled open/closed. This is an alternative to the command palette.

### Acceptance criteria

- [ ] A sidebar on the left edge of the screen lists all projects by name
- [ ] Clicking a project name switches to that project (same disconnect/reconnect logic as command palette)
- [ ] Active project is visually highlighted in the sidebar
- [ ] Each project shows a subtle status indicator (e.g., dot) for whether its tmux session is running
- [ ] Sidebar can be collapsed/expanded via a toggle button
- [ ] When collapsed, terminal panes expand to fill the full width
- [ ] Sidebar state (open/closed) is persisted to config
- [ ] Sidebar coexists with command palette — both work simultaneously
- [ ] E2E test: open sidebar, click a different project, terminals switch
- [ ] Visual test: `aiAssert("a collapsible sidebar on the left lists project names, one is highlighted as active")`

---

## Phase 7: Project Switching — Top Bar Dropdown

**User stories**: "User switches projects via a dropdown in the header"

### What to build

The current project name is displayed in a top header bar. Clicking it reveals a dropdown list of all projects. Selecting one switches to it. This is the most compact switching option.

### Acceptance criteria

- [ ] A header bar spans the top of the screen showing the current project name
- [ ] Clicking the project name opens a dropdown listing all projects
- [ ] Selecting a project from the dropdown switches to it
- [ ] Active project is visually distinct in the dropdown (bold, checkmark, or similar)
- [ ] Dropdown closes on selection or when clicking outside
- [ ] Header bar style matches Solarized Dark theme — subtle, not visually heavy
- [ ] All three switching mechanisms (palette, sidebar, dropdown) coexist and work independently
- [ ] E2E test: click header project name, dropdown appears, select project, terminals switch
- [ ] Visual test: `aiAssert("a top header bar shows the project name, with a dropdown list of other projects open below it")`

---

## Phase 8: Adopt Existing Tmux Session

**User stories**: "User creates a project from an existing tmux session"

### What to build

When creating a new project, the user can choose to adopt an existing tmux session instead of creating a fresh one. The UI shows a list of tmux sessions that are not already mapped to a DanCode project. Selecting one links it to the new project.

### Acceptance criteria

- [ ] `GET /api/tmux/sessions` returns all tmux sessions NOT already mapped to a DanCode project
- [ ] "New Project" form has an "Adopt existing tmux session" toggle/option
- [ ] When enabled, a dropdown lists available orphaned tmux sessions
- [ ] Selecting a session and submitting the form creates a project config pointing to that session (does not create a new tmux session)
- [ ] The adopted session's panes are displayed in the UI as-is
- [ ] If there are no orphaned sessions, the option is disabled or shows "No sessions available"
- [ ] Unit tests: orphan session detection (filters out `dancode-*` sessions that are already in config)
- [ ] E2E test: create a tmux session manually, open New Project form, adopt it, see its panes in DanCode

---

## Phase 9: Tmux Education + Polish

**User stories**: "User can see tmux commands without needing to know tmux", "Application feels polished and complete"

### What to build

Toggleable UI elements that display tmux commands for educational purposes. Plus a polish pass on the overall UI: consistent spacing, transitions, edge cases.

### Acceptance criteria

- [ ] Toggleable horizontal bar at the top of the terminal view showing: `tmux attach -t dancode-<project>`
- [ ] Per-pane labels can optionally show the tmux pane-switch command (e.g., `Ctrl+B, 0`)
- [ ] "Show tmux commands" toggle in the UI controls both the bar and per-pane labels
- [ ] Toggle state is persisted to config
- [ ] Polish: loading states when switching projects, smooth transitions between layout modes
- [ ] Polish: error states (tmux session died, WebSocket disconnected) show clear messages with recovery options
- [ ] Polish: consistent spacing, borders, and shadows across all components
- [ ] All 11 success criteria from the PRD (Section 9) pass
- [ ] Full E2E test suite passes
- [ ] Full visual test suite passes
