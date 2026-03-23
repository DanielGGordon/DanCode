[done 2026-03-23 04:35] The adopted session's panes are displayed in the UI as-is.
[done 2026-03-23 04:40] If there are no orphaned sessions, the option is disabled or shows "No sessions available". ⚠️ Learning: Already implemented in prior commit — toggle disabled + "No sessions available" text + tests all existed.
[done 2026-03-23 05:10] Unit tests: orphan session detection (filters out dancode-* sessions that are already in config).
[done 2026-03-23 05:00] E2E test: create a tmux session manually, open New Project form, adopt it, see its panes in DanCode. ⚠️ Learning: The dev server on port 3001 may be running stale code — if endpoints return 404, restart it. Playwright reuseExistingServer means it won't auto-restart.
[done 2026-03-23 05:30] Toggleable horizontal bar at top of terminal view showing tmux attach command.
[done 2026-03-23 06:00] Per-pane labels can optionally show the tmux pane-switch command (e.g., Ctrl+B, 0).
[done 2026-03-23 06:15] "Show tmux commands" toggle controls both bar and per-pane labels. ⚠️ Learning: Must use --config client/vite.config.js when running vitest from the repo root, otherwise jsdom environment isn't loaded and all tests fail with "window is not defined".
[done 2026-03-23 06:30] Toggle state is persisted to config.
[done 2026-03-23 07:25] Polish: loading states when switching projects, smooth transitions between layout modes.
[done 2026-03-23 07:50] Polish: error states (tmux session died, WebSocket disconnected) show clear messages with recovery options. ⚠️ Learning: Socket event handlers in tests must be wrapped in act() to flush React state updates; also avoid manual innerHTML manipulation on React-managed containers.
