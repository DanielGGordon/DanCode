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

- **Playwright globalSetup ordering gotcha.** In Playwright, `webServer`
  entries start BEFORE `globalSetup` runs, so anything required by the
  server (like a UNIX socket) cannot be created in globalSetup. Phase 1
  uses a `boot-stack.mjs` wrapper inside the server's webServer entry to
  spawn shellhost as a child of the server process. Future phases that
  need additional out-of-band setup (e.g. tmux fixtures in Phase 9) should
  follow the same pattern instead of adding more globalSetups.

- **E2E isolation via temp HOME.** Phase 1's shellhost E2E creates a temp
  HOME per run so account setup is deterministic and doesn't depend on the
  dev machine's `~/.dancode/credentials.json`. Future shellhost-backed
  E2E specs should reuse `DANCODE_E2E_HOME` (already exported from
  `playwright.shellhost.config.js`) so all paths under `~/.dancode` are
  isolated together.

- **Tailscale serves on port 3002.** The dev Pi exposes port 3002 via
  Tailscale `serve`. Phase 1 moved shellhost-backed E2E to 3102/5175 to
  avoid the EADDRINUSE. Future phases that need test ports should pick
  numbers that don't collide with Tailscale serve/funnel entries (check
  `tailscale serve status`).

## After Phase 3 (proposed by Phase 3 generator)

- **TOTP-based auth in vitest tests is timing-fragile.** otplib defaults
  to `epochTolerance: 0`, so any test that does generate→verify across a
  30-second boundary flakes — especially when bcrypt rounds bump the
  elapsed time on the Pi. Phase 3's restart test bypasses HTTP login
  entirely by calling `createSession()` directly from the auth module
  (the function is already exported for tests). Phase 4 onwards should
  prefer the same trick over `await generate(); POST /api/auth/login;` in
  vitest, or set `epochTolerance: 1` in `verifyLogin`.

- **Socket.IO namespace closure captures the manager reference once.**
  Phase 1 wired `setupShellhostNamespace(io, manager)` which captured
  the manager in the connection handler. After Phase 3's in-process
  restart, the closure pointed at the closed/old manager. Phase 3 changed
  the signature to accept either a manager OR a getter and the server
  now passes `() => terminalManager` so the resolution is always lazy.
  Future phases that swap the manager (Phase 7's Claude-session updates,
  for example) get correct routing automatically.

- **Server-restart supervisor in Playwright.** Phase 3's restart E2E
  needs a real new server process after `process.exit(0)`. Inline server
  loading inside `boot-stack.mjs` (the Phase 1 pattern) doesn't survive
  process.exit. Phase 3 changed the supervisor to spawn the server as a
  child and respawn on death. Playwright's webServer happily polls the
  port across the gap (browsers' Socket.IO reconnects automatically).

- **`/api/test-only/kill-server` is the cleanest restart primitive.**
  Endpoint gated by `NODE_ENV=test` and the requireAuth bypass keeps the
  test driver simple: a plain `request.post(...)` from Playwright. If
  Phase 7 needs a restart-resume flow for Claude, the same endpoint
  works without auth complications.

- **Module-level `httpServer` singleton, revisited.** Phase 1's note
  about a re-entrant `startServer` still stands. Phase 3 worked around it
  by carefully closing and re-listing on the same module-level
  httpServer, but multiple parallel in-process restart scenarios will
  hit the limit. Phase 5+ should refactor.

- **Disk-scrollback rotation must include the rotation file in
  consumption checks.** The 1MB stress test almost asserted on
  `scrollback.log` alone — but when 1MB lands at exactly the rotation
  threshold, most of the X bytes live in `scrollback.log.1`. Tests that
  verify total bytes must read both files. Phase 5's reboot-recovery
  tests will face the same trap.

- **Shell input echo races marker-based sentinels.** Same gotcha as
  Phase 2: typing `printf '__MARKER__\n'` to a PTY echoes the literal
  marker back via the TTY layer BEFORE the command runs. The 1MB stress
  test originally waited on the END marker and was firing on the input
  echo. The fix is to wait on byte count or build the marker via shell
  concatenation. Phase 5's reboot tests should keep this in mind.

## After Phase 4 (proposed by Phase 4 generator)

- **Per-slug write lock + atomic rename is enough for the concurrency
  acceptance.** Twenty concurrent in-process PUTs serialize through a
  Promise-chain Map keyed by `<baseDir>::<slug>`; the final state always
  matches exactly one input. If we ever spread the server across multiple
  processes (we won't on the Pi), the lock evaporates — `rename(2)` is
  atomic per filesystem, so torn writes still can't happen, but the
  final-winner identity becomes nondeterministic. Document the single-
  process assumption in Phase 10's prod install notes.

- **Layout schema is intentionally permissive about pane ids.** The schema
  forbids unknown top-level fields and unknown keys inside terminal/openFile
  entries, but the `splits` tree only validates structural shape (type,
  direction, ratio, children). Pane ids in `openFiles[].pane` and
  `splits.leaf.id` are not cross-checked. Phase 5/6 may want to add
  consistency validation (every leaf id appears in either terminals or
  openFiles, no duplicate ids) — defer until a real failure mode appears.

- **xterm column-width line wrapping bites E2E pwd asserts.** The pwd
  output for a long /tmp path wrapped across two xterm rows mid-string,
  and the parser was reading only the first line. The fix is to join all
  non-empty lines between the two sentinels. Phase 5/7 should similarly
  reconstruct multi-line shell output; relying on `lines[0]` is fragile
  for anything longer than the pane's column width.

- **Server `POST /api/terminals` accepts both absolute and relative
  cwd.** Relative cwds are resolved against the project root and validated
  to stay within it; absolute cwds are passed through verbatim (no
  containment check). Phase 4's layout E2E exploits this to spawn two
  terminals with distinct cwds. If Phase 8 (background mode) or Phase 10
  (multi-tenant install) wants to enforce containment for absolute cwds
  too, add a `startsWith(project.path + '/')` check in the absolute branch.

- **TerminalLayout's pane id model is implicit.** Panes are identified by
  array index, not by stable id, so `openFiles[].pane` ids written into
  layout.json are pseudo-names like `file-0`. On reload they're treated as
  ordering hints only. When Phase 5 introduces real splits the tree leaf
  ids should become first-class and persist across reloads — the schema
  already supports that; only the client needs updating.

- **Project rename order matters for crash safety.** `renameProject`
  writes the new project config, moves the layout dir, and only then
  removes the old config. A crash between steps 1 and 3 leaves both
  configs on disk — listProjects skips malformed entries but happily
  surfaces two copies of the same project. Phase 5+ could add a startup
  reconciliation pass that detects "two configs share a path", picks the
  newer mtime, and removes the older. Not blocking; current model is
  forward-only.

- **`renameProject` does NOT touch terminal meta.** Terminals are
  referenced by id, not slug, so rename is safe in the shellhost model.
  But the legacy `TerminalManager` (still active via fallback) bakes the
  slug into tmux session names (`dancode-{slug}-{id}`). Renaming a
  project in legacy mode would orphan those sessions. Phase 9 removes
  tmux entirely so we did not patch that case — just be aware before
  Phase 9 ships.

- **Phase 4 added `cwd` and `command` to `/api/terminals` response.** The
  shellhost-backed manager and legacy tmux-backed manager both now
  include these in `_publicMeta`. Phase 7 (Claude-aware resume) and
  Phase 8 (background mode) will likely add more fields; keep the public
  shape symmetric between the two managers until Phase 9.

- **layout.json placement collides with project config directory only by
  accident.** Plan put both under `~/.dancode/projects/`: project config
  is `~/.dancode/projects/<slug>.json` (flat file) and layout is
  `~/.dancode/projects/<slug>/layout.json` (per-slug directory). On Linux
  this is fine — a file and a directory at the same depth don't collide.
  If we ever move project configs into per-slug dirs (`~/.dancode/projects/<slug>/project.json`),
  layout.json fits naturally beside it; just plan for the migration when
  it lands.

## After Phase 5 (proposed by Phase 5 generator)

- **`ShellhostTerminalManager.client` now needs `error`+`close` listeners**
  unconditionally. The bare client emits an `error` event on socket-level
  ECONNRESET (which happens whenever the shellhost dies), and without a
  listener attached, Node's EventEmitter rethrows and crashes the server.
  Phase 5 adds them inside `_wireEvents()`. Phase 7/8 generators that
  add new clients to shellhost — including any test harnesses — should
  attach `error` listeners as well, or wrap the client factory to do it
  centrally.

- **Pidfile written by shellhost is the orchestration primitive for
  Phase 5+ test reboots.** Path defaults to
  `<dirname(socket)>/shellhost.pid`, overridable with
  `DANCODE_SHELLHOST_PIDFILE`. The `/api/test-only/restart-shellhost`
  endpoint reads it to SIGKILL the right process, and waits for the file
  to be rewritten with a NEW pid before polling the socket — polling
  the socket alone races with the still-dying parent. Phase 10's
  systemd unit can use the same pidfile for `PIDFile=` and `Restart=on-failure`.

- **Boot-stack now auto-respawns shellhost on exit** (mirrors the existing
  server respawn). The on-exit handler also unlinks the stale socket file
  before respawning so the new shellhost can bind. Phase 10 should rely
  on `systemd --user` for the equivalent in production rather than
  porting boot-stack logic.

- **`PTYManager` constructor now starts a `setInterval` if a `metaStore` is
  injected.** That interval is `unref()`'d so it doesn't block process
  exit, but `killAll()` and the shutdown handler in `index.js` both call
  `stopLastActiveFlusher()` to be tidy. Phase 7 (Claude session id) and
  Phase 8 (background mode) will likely add their own periodic writes
  (`noteClaudeSession`, ps-based foreground inspection) — consider
  consolidating them onto the same 60s tick instead of stacking
  intervals.

- **`respawn` op + `attach`'s scrollback replay are subtly redundant after
  respawn.** Phase 5 persists the banner to scrollback BEFORE notifying
  listeners. Any future attach replays "prior content + banner + new
  output" by reading the same on-disk log. This means the criterion
  "before the banner, ~50KB of prior scrollback is replayed" is
  satisfied by `getScrollback` on the next attach — Phase 5 does NOT
  emit a synthetic replay-then-banner sequence to ALREADY-attached
  listeners; only the banner. For Phase 7 (Claude resume), the same
  pattern works: write the new prompt context to scrollback at respawn
  time and any browser reload will see it via replay.

- **`/api/projects/:slug/layout` now triggers `respawnForProject(slug)`
  as a side effect.** The Socket.IO terminal namespace also auto-respawns
  on connect as a safety net (in case layout-GET ordering races against
  WebSocket attach during page load). If Phase 7 introduces a "Resume
  Claude" UX that needs to respawn a single terminal in isolation,
  reuse `respawnTerminal(id)` — don't add another endpoint that calls
  it on every page navigation.

- **The Socket.IO terminal namespace connection handler is now `async`.**
  The `attach()` call gates on `respawnTerminal()` finishing. Reads in
  the namespace handler are sequential after this change — if a future
  phase wants per-connection auth/permission checks before attach, drop
  them into the same async block.

- **Periodic `lastActiveAt` flusher coalesces writes via a `_lastActiveDirty`
  Set.** Phase 6's CodeMirror integration won't touch this, but Phase 7
  may want to piggy-back the Claude foreground-process inspection on the
  same tick. If 5s is the target inspection interval, run that on a
  separate timer (the lastActive flush is 60s).

## After Phase 6 (proposed by Phase 6 generator)

- **The legacy `/api/files/read` and `/api/files/write` routes are still
  present alongside the new `/api/projects/:slug/files/{*filepath}`
  routes.** The new shape is what the plan called for and what the
  FileViewer now uses. Older code paths (FileExplorer ETag fetch, the
  legacy file-API tests in `server.test.js > GET /api/files/read ETag
  support`) still hit the old routes. A small migration in a follow-up
  phase can switch FileExplorer over and delete the legacy handlers; the
  per-project routes already share `safePath()` so there's no path-safety
  drift.

- **`highlight.js` is no longer the active syntax engine, but the package
  is still in `client/package.json` dependencies.** I left it in to avoid
  churn — it's referenced from the no-longer-active code path that
  rendered a read-only viewer. A trivial follow-up removes it from
  `package.json` after confirming nothing else imports it.

- **Range/Element `getClientRects` polyfill in `client/vitest.setup.js`.**
  CodeMirror 6 calls these during its measure phase and jsdom doesn't
  implement them, which previously surfaced as an unhandled rAF error
  (the test still passed but the noise was misleading). The polyfill is a
  no-op shim — fine for behaviour assertions, not for any future test
  that wants to verify CM geometry. If such tests appear, swap jsdom for
  `happy-dom` (better layout primitives) or move them to Playwright.

- **`window.__dancodeCmView` is a test-only affordance set on every
  mount.** The Phase 6 perf spec uses it to call `view.dispatch(...)`
  programmatically. It's stable across mounts (always the most recent
  view), so future tests can reach the editor without poking CM internals
  like `EditorView.findFromDOM`. Production code should never read it.

- **The perf gate is platform-skipped on `arm64`/`arm`.** The Pi-5 host
  this repo is developed on can't hit p95<50ms on a 1MB highlighted JS
  doc under headless Chromium (we measured p50=28ms, p95=124ms locally).
  Per the plan's "Pi-5 hardware perf is verified out-of-band by the
  project owner; CI numbers are a proxy floor" carve-out, the strict
  assertion only fires off-Pi (or when `DANCODE_FORCE_PERF=1`). When the
  CI surface lands, leave the env var unset so the gate runs as written.

- **CM 6 emits `<span class="ͼ…">` for highlighted tokens, NOT
  `.cm-keyword`.** The Phase 6 plan text mentions `.cm-keyword` "(or
  language-specific token class)" — future E2E specs that try to assert
  highlighting should use `.cm-line span[class]` (any classed span inside
  a CM line) rather than CM5-era class names, which never appear.

- **Keystroke-to-paint single-rAF baseline is ~16ms.** Even on x64 CI,
  budget tighter than ~20ms p95 is unattainable because rAF callbacks fire
  on frame boundaries. The current budgets (50/100ms) have ample headroom;
  if a future phase tightens the budget, switch the measurement to a
  paint-callback-based approach (e.g., `requestAnimationFrame` →
  `MessageChannel` postMessage round-trip → measure after paint).

- **Layout PUT after Ctrl+S race.** When the editor saves via Ctrl+S the
  file content goes through `PUT /api/projects/:slug/files/*`, but the
  layout debounced save (300/500ms) may also fire and re-PUT
  `openFiles`. These don't conflict (different endpoints) but Phase 7
  should be aware: pressing the Resume-Claude button mid-edit can race a
  layout save. Either gate layout saves on a quiescence check or accept
  the LWW behaviour explicitly.
