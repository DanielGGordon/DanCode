# DanCode Shellhost Redesign — Proposed Changes

## After Phase 1 (proposed by Phase 1 generator)

- **Singleton state in `server/src/index.js`.** The server module exports
  `httpServer` and a mutable `terminalManager` and tracks namespace
  registration via the module-level `terminalManagerNamespaceRegistered`
  flag. Vitest now runs server test files sequentially because parallel
  forks share OS resources (tmux server, ports) and the singletons make
  reasoning hard. Phase 3 (server-restart survival) should ideally refactor
  `startServer` to be re-entrant — create a fresh httpServer per call and
  return it instead of mutating a module-level export — so test isolation
  no longer depends on `fileParallelism: false`.

- **Pre-existing flaky tests we did NOT fix.**
  - `Terminal Manager > POST /api/terminals > creates a terminal with
    projectSlug and label` — asserts `body.lastActivity` is defined but
    `terminal-manager.js#create()` returns `_publicMeta(meta)` which omits
    `lastActivity`. Either the assertion or the manager should be aligned.
    Phase 3/9 will rewrite this code path; safe to drop the assertion.
  - `Terminal Manager > Phase 4: server restart reconciliation > reattaches
    to surviving tmux sessions after simulated restart` — relies on
    `tmuxCapturePane` finding `BEFORE_RESTART` text in pane output; sometimes
    the capture happens before the echo flushes. Either retry the capture
    loop or assert via a file-based sentinel.
  - `DanCode server > allows account setup and login` — flaky around the
    TOTP 30-second window; can drift when bcrypt verification is slow. A
    small clock-tolerance window in `verifyLogin` (otplib supports `window`)
    would fix it once and for all.

- **Server-side ring buffer is duplicated work for Phase 2.** The Phase 1
  `ShellhostTerminalManager` keeps a per-terminal in-memory ring buffer so a
  reconnecting Socket.io client gets a replay. Phase 2 moves replay to
  shellhost's disk scrollback. When Phase 2 lands, drop the server-side
  ring buffer entirely and have the server pass through `output` events
  unchanged — the shellhost-side scrollback replay will handle the
  reconnection bytes.

- **Wire op auth.** Phase 1's shellhost has no transport-level authn — it
  trusts whoever can connect to the UNIX socket (filesystem permissions:
  0600). Phase 10's production install should document the trust boundary.
  If we ever add a non-local transport, a hand-shake op should be the
  first thing speaking — easy to slot in front of `dispatchOp`.

- **`socket.emit('input', data)` payloads.** The shellhost namespace
  coerces non-string inputs via `data?.toString?.('utf8')`. Phase 7's
  Claude-resume button sends keystrokes the same way the xterm onData
  callback does (always strings) so we're fine — but if any feature sends
  `Buffer` payloads, ensure they go through string conversion in the
  namespace handler.

- **`POST /api/terminals` lastActivity gap.** Both backends return
  `_publicMeta` which doesn't include `lastActivity`. The legacy
  `TerminalManager.get()` and `.list()` add it; `.create()` does not.
  Phase 4 (layout persistence) should standardize the public Terminal
  shape across all endpoints — a small audit-and-align task while we are
  defining the layout schema anyway.

- **`fileParallelism: false` is conservative.** If Phase 3 refactors away
  the singletons, server tests should re-enable parallel file execution to
  shave the ~30s test run. The current pattern blocks faster CI runs.

- **`check:setup` doesn't verify shellhost binary build.** If `node-pty`'s
  native binding fails to compile (e.g. missing libstdc++), the check
  reports build deps as green but shellhost won't actually start. Adding
  `require('node-pty')` or `node -e "import('node-pty')"` to the preflight
  catches this earlier.

- **Playwright shellhost config duplicates webServer setup.** Eventually
  Phases 2–10 will want shellhost-backed E2E across many specs. Consider
  consolidating to a single `playwright.config.js` with a single shellhost
  globalSetup and ports 3002/5175, deprecating the legacy 3001/5174 pair
  as Phase 9 removes tmux.
