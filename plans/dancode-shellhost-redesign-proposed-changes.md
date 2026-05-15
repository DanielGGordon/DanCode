# Proposed changes / learnings for future phases

## After Phase 2 (proposed by Phase 2 generator)

- Bumped xterm's client-side `scrollback` from the default 1000 lines to
  100,000 so the disk replay (~50KB; up to ~25k lines for narrow output like
  `yes`) is fully retained by the browser. If memory pressure becomes an
  issue on the Pi later, revisit and tune per-terminal.
- The legacy `e2e-helpers.login` previously read credentials from
  `homedir()/.dancode/credentials.json`, which broke any shellhost E2E test
  that ran after the first one (the temp `DANCODE_E2E_HOME` server stored
  creds in a different directory). Phase 2 fixed this by reading
  `DANCODE_E2E_HOME` first. Phase 3+ E2Es should keep using this helper
  rather than hand-rolling their own auth.
- `playwright.shellhost.config.js` now uses `workers: 1` /
  `fullyParallel: false`. Two parallel workers race POST /api/auth/setup
  against a single shared temp HOME; the loser can't read the matching TOTP
  secret. Keep serial until we have per-spec HOMEs or a setup-once fixture.
- Added a new `getScrollback` wire op (server.js + client.js). The server
  uses it on every browser-WebSocket connect to replay history without
  re-triggering shellhost's live-attach replay. Phase 3's server-restart
  recovery should also use this op when the server reconnects to a
  pre-existing shellhost — `attach` will replay automatically, but
  `getScrollback` is the per-socket primitive when one shellhost connection
  is shared by many browser sockets.
- `PTYManager` now optionally takes a `scrollback` collaborator. The kill
  path calls `scrollback.removeTerminal(id)` to remove the on-disk
  directory. Phase 3+ should be careful here: the metadata file
  (`meta.json`, planned for Phase 3) is also under
  `~/.dancode/terminals/<id>/`, so a kill that wipes the whole directory
  also wipes metadata. That's correct (the terminal is gone), but make sure
  metadata cleanup goes through the same path or a coordinated one.
- Scrollback writes use a held-open file descriptor per terminal with
  `writeSync`. We deliberately do NOT call `fsync` (Phase 2's criterion is
  "write-through, no batching that risks loss" — kernel buffers are
  acceptable). Phase 5's Pi-reboot recovery may want true fsync, but be
  aware that fsync per chunk could noticeably slow noisy terminals.
- Server-side ring buffer was only removed from `shellhost-terminal-manager.js`.
  The legacy `terminal-manager.js` (tmux backend) still has its `RingBuffer`
  and its tests in `server/tests/ring-buffer.test.js`. Phase 9's tmux
  removal can delete both.
- The Playwright E2E reload flow currently has to click the sidebar entry
  to re-open the project after `page.reload()`, because `selectedSlug` is
  in-memory only. Phase 4 (layout persistence) is the right place to
  persist the active project in localStorage so reloads land back on the
  same terminal layout automatically.
