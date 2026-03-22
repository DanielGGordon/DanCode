# DanCode — Product Requirements Document

**Author:** Dan Gordon
**Date:** 2026-03-22
**Status:** Draft

---

## 1. Problem Statement

Managing multiple coding projects on a Raspberry Pi via SSH and tmux is painful. Switching between projects requires remembering tmux session names, pane layouts, and commands. There is no unified view of what's running across projects. Checking on agentic coding loops (Ralph) from a phone or remote machine requires SSH access and tmux fluency.

DanCode is a web-based project terminal manager that abstracts tmux entirely, letting the user manage multiple projects through a browser — from any device on their Tailscale network.

---

## 2. Target Users

**Primary (MVP):** Dan — a single developer running multiple projects on a Raspberry Pi 5, using Claude Code and Ralph (agentic coding loop) heavily. Accesses Pi from a Windows desktop on the same network or remotely via Tailscale.

**Future:** Small audience of friends/coworkers who run projects on remote Linux instances. Each runs their own DanCode server.

---

## 3. MVP Scope — Phase 1: Project Terminal Manager

### 3.1 Core Feature

A web application that presents a unified, browser-based view of all active projects. Each project maps to a real tmux session managed by DanCode. The user never needs to know or type tmux commands.

### 3.2 Project Lifecycle

#### Creating a Project

- "New Project" button in the UI opens a form
- Fields:
  - **Project name** (text, required)
  - **Directory path** (text, required, pre-filled with `~/`)
- If the directory does not exist, DanCode creates it
- On submit, DanCode:
  1. Writes project config to `~/.dancode/`
  2. Creates a tmux session named `dancode-<project-slug>`
  3. Creates default panes (see 3.3)
  4. Switches the UI to the new project

#### Creating a Project from Existing Tmux Session

- "New Project" form also offers an "Adopt existing tmux session" option
- Shows a list of tmux sessions NOT already mapped to a DanCode project
- User selects one, provides a project name and directory path
- DanCode adopts (does not recreate) the session

#### Deleting a Project

- Removes project from DanCode config only
- Does NOT kill the tmux session — it remains accessible via `tmux attach`
- The tmux session becomes available for adoption by a new project

### 3.3 Terminal Panes

Each project has 2-3 terminal panes, each backed by a real tmux pane in the project's tmux session.

**Default panes on new project creation:**

| Pane | Purpose | Auto-launched command |
|------|---------|---------------------|
| CLI | General shell | `cd <project-dir>` |
| Claude | Claude Code conversation | `cd <project-dir> && claude --dangerously-skip-permissions` |

**Optional 3rd pane:**

| Pane | Purpose | Auto-launched command |
|------|---------|---------------------|
| Ralph | Agentic coding loop | None — just a shell `cd`'d to project dir. UI shows info on how to use Ralph. |

- Users can toggle panes on/off (show/hide in the UI)
- The underlying tmux panes persist regardless of visibility

**Tmux mirroring:** The tmux session is real. If the user SSH's into the machine and runs `tmux attach -t dancode-myproject`, they see the exact same panes with the same content. DanCode is a window into tmux, not a replacement.

### 3.4 Layout

**Desktop (>768px):**
- Default: responsive split view — panes displayed side by side (2 panes = 50/50, 3 panes = 33/33/33)
- Toggle to switch to tabbed mode on desktop
- Click any pane to focus/interact with it

**Mobile (<768px):**
- Automatic tabbed mode — one pane visible at a time, tabs to switch

**Layout persistence:** The layout mode and visible panes are saved per-project in config.

### 3.5 Project Switching

Build all three options, ship with command palette as default:

**Option A: Command Palette (default)**
- Hotkey (e.g., `Ctrl+K`) opens a fuzzy-search overlay
- Type project name, hit Enter to switch
- Fast for keyboard users

**Option B: Sidebar**
- Collapsible left sidebar listing all projects
- Click to switch
- Shows project name and active/inactive status

**Option C: Top Bar Dropdown**
- Current project name displayed in header bar
- Click to reveal dropdown list of all projects

The user can switch between these modes via a setting (future) or they coexist (sidebar + command palette is a common pattern).

### 3.6 Tmux Education Features

**Attach command bar:**
- Optional horizontal bar at the top of the screen
- Displays the exact command to attach to the current project's tmux session: `tmux attach -t dancode-<project>`
- Togglable on/off

**Per-pane tmux info:**
- Each pane can optionally show the tmux command to navigate to it (e.g., `Ctrl+B, 1`)
- Togglable "Show tmux commands" mode

### 3.7 Configuration

**Location:** `~/.dancode/`

**Project config:** JSON files storing:
- Project name
- Directory path
- Tmux session name
- Enabled panes (which are visible)
- Layout mode (split vs tabs)
- Any per-project settings

The config format (single file vs one-per-project) is an implementation detail left to the developer.

### 3.8 Authentication

**MVP:** Simple token-based auth.
- A token is generated on first run and stored in `~/.dancode/auth-token`
- The web UI prompts for the token on first visit, stores it in browser localStorage
- All WebSocket and REST requests include the token
- Sufficient security because network access is restricted to Tailscale

### 3.9 Networking

- DanCode server runs on the Pi (or any Linux instance), listens on port `3000`
- Accessed via browser at `http://<tailscale-ip>:3000`
- No HTTPS required for MVP (Tailscale provides encryption)

---

## 4. Tech Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Backend | Node.js + Express | node-pty (xterm.js server companion) is a Node library; natural fit |
| WebSocket | Socket.io | Built-in reconnection, room management for project/pane switching |
| Frontend | React + Vite | Agent produces most reliable code with React; Vite for fast builds |
| Terminal | xterm.js | Industry standard browser terminal emulator, no alternative |
| Styling | Tailwind CSS | Utility-first, agents produce consistent output, minimal architecture decisions |
| Theme | Solarized Dark only | Dark blue-gray (#002b36 base), polished/modern feel with subtle borders, soft glows on active elements, slight panel transparency |
| Testing | Vitest (unit/integration) + Playwright (E2E) + Midscene.js (visual) |
| Visual AI | Ollama + Phi-3.5-Vision (local on Pi) | Zero-cost, baseline-free visual assertions |

---

## 5. Testing Strategy

### 5.1 Prerequisites

Before any test tasks begin, the plan MUST include setup tasks to:
1. Install Ollama: `curl -fsSL https://ollama.com/install.sh | sh`
2. Pull the vision model: `ollama pull phi3.5:3.8b-mini-instruct-q4_K_M`
3. Verify Ollama is serving: `curl http://localhost:11434/api/tags`
4. Install Playwright browsers: `npx playwright install chromium`
5. Install Midscene.js: `npm install @anthropic-ai/midscene` (or correct package name — verify at implementation time)

### 5.2 Test Layers

**Unit / Integration (Vitest):**
- Project config CRUD (create, read, update, delete)
- Tmux session lifecycle (create session, create panes, kill session)
- Auth token generation and validation
- WebSocket message routing
- Run on every task

**End-to-End (Playwright):**
- Server starts, browser opens, login with token
- Create a new project, verify panes appear
- Switch projects via command palette
- Toggle pane visibility
- Responsive layout changes at breakpoints
- Run after each phase

**Visual Assertions (Midscene.js + Ollama):**
- `aiAssert("two terminal panes are displayed side by side filling the screen")`
- `aiAssert("a command palette overlay is centered on the screen with a search input")`
- `aiAssert("the application uses a dark color scheme")`
- 10-60 second latency per assertion on Pi 5 — acceptable for agentic loop
- Run as part of E2E suite

### 5.3 Agentic Testing Principles

- All tests must pass without human intervention
- No screenshot baselines requiring human approval
- Tests must be runnable on Pi 5 (ARM64, 8GB RAM)
- Visual tests use natural language assertions, not pixel comparison
- If a test requires interactive input, it's not a valid test for this project

---

## 6. Architecture Overview

```
Browser (any device on Tailnet)
├── React app (Vite build)
│   ├── xterm.js instances (one per visible pane)
│   ├── Project switcher (command palette / sidebar / dropdown)
│   ├── New Project form
│   ├── Pane toggle controls
│   └── Tmux education bar
│
│   Socket.io
│   ↕
Pi / Linux Server (port 3000)
├── Express static file server (serves React build)
├── Socket.io server
│   ├── Auth middleware (token validation)
│   ├── Terminal namespace
│   │   └── Per-pane: Socket.io ↔ node-pty ↔ tmux attach -t <session>:<pane>
│   └── Project namespace
│       └── CRUD operations on ~/.dancode/ config
├── Tmux manager module
│   ├── Create/destroy sessions
│   ├── Create/manage panes
│   ├── List sessions (for adoption)
│   └── Attach to panes via node-pty
└── Config module
    └── Read/write ~/.dancode/ JSON files
```

### 6.1 Terminal Connection Flow

1. User selects a project in the UI
2. Frontend opens Socket.io connections for each visible pane
3. Backend spawns `node-pty` processes running `tmux attach -t dancode-<project>:<pane-index>`
4. Bidirectional data: keystrokes flow browser → Socket.io → node-pty → tmux pane; output flows back
5. On project switch: disconnect old pane sockets, connect new ones

---

## 7. Future Phases (NOT in MVP)

These features are explicitly deferred. They are documented here so design decisions are not lost.

### Phase 2: File Explorer + Code Editor

- **File explorer:** tree view sidebar showing project directory structure
- **Code editor:** Monaco Editor (VS Code's editor component) for viewing/editing files
- **Integration:** clicking a file in explorer opens it in Monaco
- **File operations:** create, rename, delete files/directories from the UI
- **Saving:** standard Ctrl+S, writes via backend API
- **Separate plan file** for Ralph to execute

### Phase 3: Ralph UI Controls

- Dedicated Ralph control panel (not just a terminal pane)
- Launch Ralph with interactive prompts: "Run Ralph with codex reviewer from plan.md?"
- Visual status: current task, progress bar, elapsed time, cost
- Buttons for /pause, /skip, /stop, /resume
- Inject context text that Ralph picks up on next loop
- View Ralph log output in a formatted view (not raw terminal)

### Phase 4: Multi-Server Management

- Connect DanCode to multiple remote Linux instances
- Architecture TBD: likely DanCode server on each machine, client knows about multiple servers
- Unified project list across servers
- Server health/status indicators

### Phase 5: User Accounts + Auth

- OAuth or password-based authentication
- Multi-user support (each user sees their own projects)
- Role-based access (viewer vs editor)
- Required before offering to friends/coworkers on shared infrastructure

### Phase 6: Enhanced Features

- **Notifications:** Ralph finished, build failed, etc. (push notifications on mobile)
- **Git integration:** branch indicator, commit from UI, PR status
- **Settings UI:** per-project and global settings editor in the browser
- **Light mode:** (if demanded by future users, not Dan)
- **Theming:** additional color schemes beyond Solarized Dark
- **Session recording/playback:** review what happened while you were away
- **Claude conversation picker:** for the Claude pane, select which existing Claude Code conversation to resume (stretch goal mentioned during design)

---

## 8. Constraints

- **Agentic development only:** This project is built by Ralph (AI coding loop). Every task must be completable without human intervention. Ambiguous specs = blocked agent = Dan back in the loop.
- **Pi 5 is the dev and deploy target:** 4 cores, 8GB RAM, ARM64. Everything must run here.
- **No external service dependencies for core features:** No cloud APIs, no SaaS platforms for core functionality. Visual testing uses local Ollama inference.
- **Tmux is an implementation detail:** The user never needs to know tmux exists. DanCode manages sessions, panes, and lifecycle entirely.

---

## 9. Success Criteria

MVP Phase 1 is complete when:

1. User can open `http://<pi-ip>:3000` in a browser, enter a token, and see the DanCode UI
2. User can create a new project (name + path), and DanCode creates a tmux session with CLI + Claude panes
3. User can create a project by adopting an existing tmux session
4. User can switch between projects via command palette (Ctrl+K, fuzzy search)
5. Terminal panes are fully interactive (typing, scrolling, copy/paste)
6. Panes can be toggled on/off
7. Layout is split view on desktop, tabs on mobile
8. Desktop users can toggle to tabbed mode
9. Tmux attach command is displayed in a toggleable bar
10. All tests pass autonomously on Pi 5
11. Deleting a project removes config but preserves tmux session
