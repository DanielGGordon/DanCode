# DanCode — Future Phases (Not for Ralph)

> Source PRD: docs/PRD.md, Section 7
>
> **These are NOT actionable tasks.** This document preserves design decisions
> and feature intent for future planning. Do not add checkboxes.

---

## File Explorer + Code Editor

Tree view sidebar showing the project directory structure. Monaco Editor (VS Code's
editor component) for viewing and editing files. Clicking a file in the explorer
opens it in Monaco. File operations include create, rename, and delete for both
files and directories. Standard Ctrl+S saves via a backend API endpoint.

This should be a separate plan file when the time comes.

---

## Ralph UI Controls

A dedicated Ralph control panel beyond the raw terminal pane. Should include:

- Interactive launch flow: "Run Ralph with codex reviewer from plan.md?"
- Visual status display: current task, progress bar, elapsed time, cost
- Buttons for /pause, /skip, /stop, /resume mapped to Ralph's slash commands
- Text input for injecting context that Ralph picks up on the next loop iteration
- Formatted log view (parsed Ralph output, not raw terminal escape codes)

---

## Multi-Server Management

Connect DanCode to multiple remote Linux instances. Architecture TBD — likely
DanCode server runs on each machine, and the client knows about multiple servers.
Unified project list across servers. Server health and status indicators.

The original use case: Dan is at the office on a Windows machine, Pi is at home.
Tailscale handles networking. Future use case: managing projects across multiple
dev servers.

---

## User Accounts + Auth

Replace token auth with real user accounts for multi-user scenarios:

- OAuth or password-based authentication
- Multi-user support (each user sees their own projects)
- Role-based access (viewer vs editor)
- Required before offering DanCode to friends/coworkers on shared infrastructure

---

## Enhanced Features

A collection of features that came up during design but are not prioritized:

- **Notifications**: Ralph finished, build failed, etc. Push notifications on mobile.
- **Git integration**: branch indicator, commit from UI, PR status.
- **Settings UI**: per-project and global settings editor in the browser.
- **Light mode**: only if demanded by future users.
- **Theming**: additional color schemes beyond Solarized Dark.
- **Session recording/playback**: review what happened while away.
- **Claude conversation picker**: for the Claude pane, select which existing Claude Code conversation to resume. Stretch goal from original design discussion.
