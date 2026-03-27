# Plan: Terminal Abstraction & Frontend-Owned UX

> Source: [GitHub Issue #1 — PRD: Terminal Abstraction & Frontend-Owned UX](https://github.com/DanielGGordon/DanCode/issues/1)

## Project config

- **Tech stack**: Node.js, Express 5, Socket.io 4, node-pty, React 19, Vite, xterm.js 6, Tailwind CSS 4 (unchanged from existing)
- **Eval approach**: Vitest (unit/integration) + Playwright (E2E, including mobile emulation) + Midscene.js (visual assertions)
- **AI surface**: Not applicable this iteration — DanCode is the AI surface (it hosts Claude Code and Ralph terminals)

## Architectural decisions

Durable decisions that apply across all phases:

- **Dev port**: `3001` for development and testing (production DanCode remains on `3000` undisturbed)
- **Worktree**: All development happens in a git worktree, not the main working tree
- **Config location**: `~/.dancode/` (unchanged)
- **Terminal IDs**: UUIDv4, generated server-side
- **Terminal metadata storage**: `~/.dancode/terminals/{terminalId}.json`
- **REST routes (new)**:
  - `POST /api/terminals` — create terminal
  - `GET /api/terminals?project=<slug>` — list terminals for project
  - `GET /api/terminals/:id` — get terminal metadata
  - `PATCH /api/terminals/:id` — update terminal (label, etc.)
  - `DELETE /api/terminals/:id` — kill terminal
- **REST routes (removed)**:
  - `GET /api/tmux-status` — removed
  - `GET /api/tmux/sessions` — removed
  - `GET /api/projects/:slug/panes` — removed
  - `DELETE /api/projects/:slug/panes/:windowIndex` — removed
- **REST routes (new, Phase 5)**:
  - `GET /api/files?path=<dir>&project=<slug>` — list directory
  - `GET /api/files/read?path=<file>&project=<slug>` — read file
  - `PUT /api/files/write` — write file
  - `POST /api/files/mkdir` — create directory
  - `POST /api/files/rename` — rename/move
  - `DELETE /api/files?path=<path>&project=<slug>` — delete
- **WebSocket**: `/terminal/:id` namespace per terminal (replaces single `/terminal` namespace with query params)
- **Output ring buffer**: ~50KB per terminal, in-memory, not persisted to disk
- **Shell**: `$SHELL` with `/bin/bash` fallback
- **Tmux session naming (Phase 4)**: `dancode-{projectSlug}-{terminalId}` (invisible to client)
- **Project config schema change**: Drop `tmuxSession`, `showTmuxCommands` fields. Add `terminals` array (ordered terminal IDs) and `layout` object with `{ mode, splitSizes, activeTab }`
- **Default terminals on project creation**: "CLI" (shell at project path) + "Claude" (`claude --dangerously-skip-permissions` at project path)
- **PWA manifest**: `/manifest.json` served by Express, Solarized Dark theme color `#002b36`
- **Responsive breakpoints**: `<480px` phone, `480-768px` phone landscape, `768-1024px` tablet, `>1024px` desktop

---

## Phase 1: TerminalManager + Single Terminal End-to-End
<!-- PHASE 1 COMPLETE -->

**Delivers**: A new server-side `TerminalManager` module that spawns PTY processes directly (no tmux), exposes CRUD REST endpoints and a per-terminal WebSocket namespace, and a minimal proof-of-concept page in the browser that connects one xterm.js instance to a terminal via the new API. The existing tmux-based terminal flow remains functional alongside — this phase adds the new path without removing the old one.

**Acceptance criteria**:
- `POST /api/terminals` with `{ projectSlug, label }` creates a PTY process and returns `{ id, projectSlug, label, createdAt }`
- `GET /api/terminals?project=<slug>` returns an array of terminal objects for that project
- `GET /api/terminals/:id` returns a single terminal object
- `PATCH /api/terminals/:id` with `{ label }` updates the terminal's label
- `DELETE /api/terminals/:id` kills the PTY process and returns 204
- Terminal metadata is written to `~/.dancode/terminals/{id}.json` on creation and removed on deletion
- WebSocket connection to `/terminal/:id` streams PTY output and accepts input
- `resize` event on the WebSocket resizes the PTY (verified: run `stty size` in terminal after resize, dimensions match)
- PTY spawns the user's `$SHELL` (or `/bin/bash` fallback) with `cwd` set to the project's path
- If `command` param is provided on creation, it is executed inside the shell after spawn
- PTY stays alive when the WebSocket disconnects (verified: create terminal, disconnect, reconnect, process still running)
- Output ring buffer captures ~50KB of output; on WebSocket reconnect, buffered output is replayed before live streaming resumes
- All existing auth middleware applies to the new endpoints (401 without valid token)
- Server starts on port 3001 for development and tests
- Vitest tests cover: terminal CRUD, metadata persistence, WebSocket I/O, reconnection replay, auth enforcement
- Playwright test: open browser, create terminal via API, type `echo hello` in xterm, see `hello` in output

---

## Phase 2: Multi-Terminal Layout + Project Integration
<!-- PHASE 2 COMPLETE -->

**Delivers**: The new TerminalManager fully replaces the old tmux-based terminal flow. `PaneLayout` is replaced by `TerminalLayout` — a frontend-owned layout component that supports split and tabbed views with dynamic terminal creation. Project creation uses the new terminal API. All tmux code is removed from client and server. The old "adopt session" flow is removed.

**Acceptance criteria**:
- `TerminalLayout` component renders multiple terminals in split view (side-by-side, equal width) or tabbed view
- Users can switch between split and tabbed layout modes
- Mobile viewports (<768px) automatically use tabbed mode
- "+" button creates a new terminal for the current project (label defaults to "Terminal N")
- Close button on a terminal kills it (with confirmation dialog) via `DELETE /api/terminals/:id`
- Terminal labels are editable inline (double-click to edit, Enter to save, Escape to cancel) via `PATCH /api/terminals/:id`
- Click-to-focus highlights the active terminal with a left accent bar (Solarized blue)
- `Ctrl+Scroll` font sizing works (8-32pt range)
- `Ctrl+C` copies selected text, `Ctrl+V` pastes — same behavior as current
- Creating a new project (`POST /api/projects`) automatically creates 2 terminals: "CLI" (shell) and "Claude" (runs `claude --dangerously-skip-permissions`)
- "Adopt existing tmux session" option is removed from NewProjectForm
- Layout state (terminal order, split/tab mode, active tab) is persisted in project config via `PATCH /api/projects/:slug`
- Sidebar no longer shows tmux status dots, "Copy tmux command", or "Kill session" context menu items
- `tmux.js` module is removed (or emptied, preserving the file for Phase 4)
- `/api/tmux-status`, `/api/tmux/sessions`, `/api/projects/:slug/panes` endpoints are removed
- `tmuxSession` and `showTmuxCommands` fields are removed from project config schema
- All existing Vitest and Playwright tests are updated to work with the new architecture
- Playwright test: create a project, see 2 terminals (CLI + Claude), create a 3rd, rename it, close it, switch to tab mode and back

---

## Phase 3: Reconnection UX & Polish

**Delivers**: Seamless reconnection experience when the browser loses connection. Terminal shows a "Reconnecting..." overlay, automatically reconnects, replays buffered output, and resumes live streaming. Connection state is clearly visible per terminal.

**Acceptance criteria**:
- Each terminal displays a connection state indicator: connected (green dot), reconnecting (yellow pulsing), disconnected (red)
- When WebSocket disconnects, a semi-transparent "Reconnecting..." overlay appears on the terminal
- Socket.io automatic reconnection attempts resume the WebSocket connection
- On successful reconnect, buffered output is replayed (terminal catches up to current state) and the overlay disappears
- If reconnection fails after 30 seconds, overlay changes to "Disconnected" with a manual "Reconnect" button
- The `session-exit` event (PTY process ended) shows a distinct "Session ended" state with exit code
- Drag-and-drop image upload to terminal still works (uploads via `/api/projects/:slug/upload`, injects path)
- Command palette (`Ctrl+K`) project switching works with new terminal architecture
- `Alt+Left` / `Alt+Right` project cycling works
- Playwright test: connect to terminal, simulate network drop (disconnect socket), verify overlay appears, reconnect, verify output is replayed and terminal is interactive

---

<!-- PARALLEL 4,5,6 -->

## Phase 4: Invisible Tmux Persistence + Host Access

**Delivers**: Each terminal's PTY is now spawned inside a hidden tmux session, invisible to the client. Processes survive server restarts. On startup, the server reconciles tmux sessions with terminal metadata and reattaches. Power users can `tmux ls` and `tmux attach` directly.

**Acceptance criteria**:
- Creating a terminal spawns the PTY inside a tmux session named `dancode-{projectSlug}-{terminalId}`
- No tmux concepts appear in any API response or WebSocket message (verified: grep API responses for "tmux" returns nothing)
- `tmux ls` on the host lists all DanCode-managed sessions with clean names
- `tmux attach -t dancode-{slug}-{id}` connects to the same terminal visible in the browser
- Input from `tmux attach` and the browser are interleaved — both see the same output
- Server restart: stop server, start server, all terminals reappear in the UI with status "reconnecting", then resume
- On restart, output ring buffer is repopulated from tmux scrollback (`tmux capture-pane`)
- Orphaned tmux sessions (metadata exists, no PTY handle) are reattached automatically
- Stale metadata (no matching tmux session) is cleaned up with a warning log
- Terminal metadata files include the `tmuxSessionName` field
- Vitest tests: create terminal, verify tmux session exists, kill server (simulate), restart, verify reattachment
- Playwright test: create terminal, type something, restart server, reload browser, verify terminal reconnects with previous output visible

---

## Phase 5: File Explorer

**Delivers**: A server-side file system API with path traversal protection, and a client-side tree view panel. Users can browse project files, create/rename/delete files and directories, and drag files onto terminals to insert paths.

**Acceptance criteria**:
- `GET /api/files?path=<dir>&project=<slug>` returns directory contents: `[{ name, type, size, modified }]`
- `GET /api/files/read?path=<file>&project=<slug>` returns file contents (text, up to 1MB)
- `PUT /api/files/write` with `{ path, content, project }` writes file contents
- `POST /api/files/mkdir` with `{ path, project }` creates a directory
- `POST /api/files/rename` with `{ oldPath, newPath, project }` renames/moves
- `DELETE /api/files?path=<path>&project=<slug>` deletes file or directory
- All file API paths are validated to be within the project directory — path traversal attempts (`../`) return 403
- Symlinks are resolved and validated to stay within project bounds
- File explorer panel appears as a collapsible left panel alongside terminals
- Directories expand on click (lazy-loaded from API)
- File icons distinguish folders, code files (.js, .py, .md, etc.), config files, and images
- Right-click context menu on files/directories: rename, delete, copy path, new file, new folder
- Double-click a file copies its path to clipboard (or inserts into focused terminal)
- "Open terminal here" context menu on directories creates a new terminal with `cwd` set to that directory
- Drag a file from explorer onto a terminal inserts the relative file path
- `.gitignore` patterns are respected by default (toggle to show ignored files)
- File explorer panel can be collapsed/hidden, state persisted in project config
- Hidden files (dotfiles) are hidden by default with a toggle to show
- Vitest tests: file API CRUD, path traversal rejection, gitignore filtering
- Playwright test: expand directories, create a file, rename it, delete it, drag file to terminal

---

## Phase 6: PWA + Mobile Dashboard

**Delivers**: DanCode is installable as a PWA on Android. Mobile users see a monitoring-first status dashboard showing all projects with activity indicators. Swipe navigation moves between projects and terminals.

**Acceptance criteria**:
- `/manifest.json` served with app name "DanCode", theme color `#002b36`, display `standalone`, appropriate icons
- Service worker caches app shell assets (HTML, JS, CSS) for fast loading
- "Add to Home Screen" prompt works on Android Chrome
- App launches full-screen (no browser chrome) when opened from home screen
- `GET /api/terminals?project=<slug>` response includes `lastActivity` timestamp (updated on each PTY output event)
- Mobile view (`<768px`) defaults to a status dashboard (not a terminal)
- Dashboard shows project cards: project name, terminal labels, activity indicator (active/idle based on `lastActivity`), last few lines of terminal output as preview
- Tap a project card to see its terminals listed
- Tap a terminal to enter full-screen terminal view
- Back button/gesture returns to dashboard from terminal view, or to project list from terminal list
- Swipe left/right between terminals within the same project
- Dot indicators show which terminal is active (pagination dots)
- Swipe from left edge opens project drawer
- Pull-to-refresh on dashboard updates activity status
- Desktop layout (`>1024px`) is unaffected — no dashboard, same split/tab view as before
- Playwright mobile emulation test: open on Pixel 5 viewport, see dashboard, tap project, tap terminal, swipe between terminals, swipe back

---

## Phase 7: Mobile Terminal + Shortcut Bar

**Delivers**: Full-screen mobile terminal with a read-first design and a system-wide shortcut bar for common key combinations. The mobile terminal experience is optimized for monitoring and light interaction.

**Acceptance criteria**:
- Mobile terminal view is full-screen: no sidebar, no header — only a thin top bar with back button and terminal label
- Terminal is read-first: soft keyboard is not shown by default, terminal output is scrollable
- Tap terminal area or a keyboard icon button to show soft keyboard (enter input mode)
- Shortcut bar appears above the soft keyboard when keyboard is active
- Shortcut bar contains: `Ctrl+C`, `Ctrl+V`, `Ctrl+D`, `Tab`, `↑`, `↓`, `Esc`
- Shortcut buttons are minimum 44px tap targets
- Shortcut bar scrolls horizontally if buttons exceed screen width
- Tapping a shortcut button sends the corresponding key sequence to the terminal
- Shortcut bar hides when keyboard is dismissed
- Long-press a project card on dashboard for quick actions: open CLI terminal, open Claude terminal
- Font size respects pinch-to-zoom gesture on mobile
- Landscape mode: terminal uses full width, shortcut bar along the bottom
- Tablet viewports (768-1024px) can optionally show 2 terminals side-by-side with shortcut bar available
- Playwright mobile emulation test: open terminal on mobile, verify read-first (no keyboard), tap to show keyboard, verify shortcut bar appears, tap Ctrl+C shortcut, verify it sends interrupt signal
