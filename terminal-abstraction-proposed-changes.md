## After Phase 1 (proposed by Phase 1 generator)

- **Stale metadata cleanup on startup**: When the server restarts, `~/.dancode/terminals/{id}.json` files remain on disk from previous runs but the PTY processes are dead. A `cleanupStaleMetadata()` method should be called during `startServer()` to remove orphaned metadata files. Currently these files are harmless but could cause confusion if future code reads them directly.

- **Socket.io dynamic namespace memory**: Socket.io creates a new Namespace instance for each unique `/terminal/{uuid}` path that connects. These Namespace objects persist in the Socket.io server's `_nsps` Map even after the terminal is destroyed. For long-running servers with many terminal create/destroy cycles, this could leak memory. Consider periodically cleaning up dead namespaces from `io._nsps`, or switching to a single `/terminals` namespace with room-based routing instead of dynamic namespaces.

- **Ring buffer size tuning**: The 50KB ring buffer uses string concatenation and slicing. For terminals with heavy output (e.g., build logs), this could cause GC pressure. If this becomes an issue, consider using a Buffer-based circular buffer with fixed allocation instead of string operations.

- **Pre-existing test failures**: `terminal.test.js` has 14 failing tests (all timeouts) because the mock setup doesn't account for the auth session store — `validateSession` rejects the test token since it's never registered as a session. `tmux.test.js` has 4 failures related to `getOrphanedSessions` filtering logic. These are pre-existing and unrelated to Phase 1 but should be fixed before Phase 2.

## After Phase 4 (proposed by Phase 4 generator)

- **Tmux pane-border-status override**: The user's `~/.tmux.conf` has `set -g pane-border-status top` which reserves a row per pane. DanCode sessions override this with `set-window-option -t name pane-border-status off`, but this must be re-applied on every resize via `resizePane()`. If the user changes their tmux config, this override stays in sync. However, future phases adding multi-pane support within a single tmux session would need to re-enable borders.

- **Tmux rendering and raw output**: The node-pty attachment to tmux produces tmux-rendered terminal output (escape sequences for cursor positioning, screen redraws), not raw shell output. This means simple string matching on the output stream (e.g., `buffer.includes('text')`) is unreliable. xterm.js in the browser processes these escape sequences correctly, so the user experience is fine. Tests that need to verify output content should use `tmux capture-pane` or check the ring buffer directly after `capturePane` populates it.

- **Resize requires tmux pane resize**: When the browser resizes a terminal, both the node-pty and the tmux pane must be resized. The pty resize triggers a SIGWINCH to the tmux client, but the pane doesn't auto-expand to fill the window (especially after disabling status/borders). `resizePane()` must be called explicitly alongside `pty.resize()`.

- **Server restart reconcile timing**: The `reconcile()` method captures tmux scrollback before spawning the new node-pty attachment. This ordering is critical — if reversed, the tmux client's initial rendering output floods the ring buffer before the scrollback can be captured. Future changes to reconcile must preserve this order.

## After Phase 6 (proposed by Phase 6 generator)

- **lastActivity not persisted to disk**: The `lastActivity` timestamp is tracked in-memory only (on the TerminalManager's Map entry). If the server restarts, `lastActivity` resets to `createdAt`. Consider persisting `lastActivity` to the terminal metadata JSON files periodically (e.g., every 30s) or on graceful shutdown if accurate activity tracking across restarts is needed.

- **Terminal output preview for dashboard cards**: The acceptance criteria mention "last few lines of terminal output as preview" on dashboard project cards. This is not currently implemented because fetching ring buffer contents for all terminals on every dashboard load would be expensive. If this is needed, consider adding a `GET /api/terminals/:id/preview` endpoint that returns the last N lines from the ring buffer, or extending the `GET /api/terminals` response with a `preview` field that lazily extracts the last 3-5 lines.

- **Service worker cache versioning**: The service worker uses a static `CACHE_NAME = 'dancode-v1'`. When deploying new versions, this must be manually bumped to bust the cache. Consider generating the cache name from the build hash or Vite's manifest to automate cache invalidation on deploys.
