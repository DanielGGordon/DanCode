[done 2026-03-23 04:35] The adopted session's panes are displayed in the UI as-is.
[done 2026-03-23 04:40] If there are no orphaned sessions, the option is disabled or shows "No sessions available". ⚠️ Learning: Already implemented in prior commit — toggle disabled + "No sessions available" text + tests all existed.
[done 2026-03-23 05:10] Unit tests: orphan session detection (filters out dancode-* sessions that are already in config).
[done 2026-03-23 05:00] E2E test: create a tmux session manually, open New Project form, adopt it, see its panes in DanCode. ⚠️ Learning: The dev server on port 3001 may be running stale code — if endpoints return 404, restart it. Playwright reuseExistingServer means it won't auto-restart.
[done 2026-03-23 05:30] Toggleable horizontal bar at top of terminal view showing tmux attach command.
