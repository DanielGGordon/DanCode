## After Phase 1 (proposed by Phase 1 generator)

- **Stale metadata cleanup on startup**: When the server restarts, `~/.dancode/terminals/{id}.json` files remain on disk from previous runs but the PTY processes are dead. A `cleanupStaleMetadata()` method should be called during `startServer()` to remove orphaned metadata files. Currently these files are harmless but could cause confusion if future code reads them directly.

- **Socket.io dynamic namespace memory**: Socket.io creates a new Namespace instance for each unique `/terminal/{uuid}` path that connects. These Namespace objects persist in the Socket.io server's `_nsps` Map even after the terminal is destroyed. For long-running servers with many terminal create/destroy cycles, this could leak memory. Consider periodically cleaning up dead namespaces from `io._nsps`, or switching to a single `/terminals` namespace with room-based routing instead of dynamic namespaces.

- **Ring buffer size tuning**: The 50KB ring buffer uses string concatenation and slicing. For terminals with heavy output (e.g., build logs), this could cause GC pressure. If this becomes an issue, consider using a Buffer-based circular buffer with fixed allocation instead of string operations.

- **Pre-existing test failures**: `terminal.test.js` has 14 failing tests (all timeouts) because the mock setup doesn't account for the auth session store — `validateSession` rejects the test token since it's never registered as a session. `tmux.test.js` has 4 failures related to `getOrphanedSessions` filtering logic. These are pre-existing and unrelated to Phase 1 but should be fixed before Phase 2.
