# Plan: DanCode shellhost redesign (drop tmux)

> Source: https://github.com/DanielGGordon/DanCode/issues/2

## Project config

- **Tech stack**: Node 20+, Express 5, Socket.IO, node-pty, xterm.js, CodeMirror 6, Vitest, Playwright (headless Chromium) for browser-side E2E. UNIX-socket RPC between two Node processes (`dancode-server` and `dancode-shellhost`). systemd `--user` for shellhost in production. No tmux.
- **Eval approach**: Vitest unit + integration tests across three workspaces (`server`, `client`, new `shellhost`). Integration tests run a real shellhost on a temp UNIX socket. Browser-side flows are covered by Playwright in headless mode against a real `npm run dev` server. **Every acceptance criterion is fully automated** — no test run requires a human.
- **AI surface**: DanCode remains AI-editable by running Claude Code inside a DanCode terminal (eat-your-own-dogfood). Claude-aware resume (Phase 7) makes this loop tight: kill DanCode, reboot Pi, re-open project, Claude conversation resumes automatically. No in-app chat panel — terminal IS the AI surface.

## Architectural decisions

- **Process model**: Two long-lived processes. `dancode-server` (HTTP/WS, files, projects, auth) is restartable / replaceable. `dancode-shellhost` (PTY ownership, scrollback writers) is the durable backend. They communicate over `~/.dancode/shellhost.sock`. Browsers only talk to `dancode-server`.
- **RPC framing**: length-prefixed JSON frames over the UNIX socket. Every request carries a `requestId`; events from shellhost carry a `terminalId`. Frame envelope: `{ type: 'req' | 'res' | 'event', requestId?, terminalId?, op, payload }`.
- **Wire ops (shellhost ↔ server)**:
  - Commands: `spawn`, `attach`, `detach`, `write`, `resize`, `kill`, `list`, `inspect`, `setBackground`, `noteClaudeSession`.
  - Events: `output`, `exit`, `respawn-needed`.
  - Disconnecting the server from the socket MUST NOT kill PTYs; only an explicit `kill` op does.
- **HTTP routes (unchanged shape, semantics shift)**:
  - `GET /api/projects`, `POST /api/projects`, `PATCH /api/projects/:slug`, `DELETE /api/projects/:slug`
  - `GET /api/projects/:slug/layout`, `PUT /api/projects/:slug/layout`
  - `GET /api/projects/:slug/files`, `GET /api/projects/:slug/files/*`, `PUT /api/projects/:slug/files/*`
  - `POST /api/projects/:slug/upload`
  - `GET /api/terminals?projectSlug=`, `POST /api/terminals`, `DELETE /api/terminals/:id`
  - `POST /api/terminals/:id/background` (toggle background mode)
  - WebSocket `/terminal/:id` proxies bytes both ways to shellhost.
  - Auth endpoints unchanged.
- **On-disk layout**:
  - `~/.dancode/shellhost.sock` — runtime socket.
  - `~/.dancode/terminals/<id>/meta.json` — `{ id, projectSlug, cwd, command, claudeSessionId, background, createdAt, lastActiveAt }`.
  - `~/.dancode/terminals/<id>/scrollback.log` — append-only PTY output, rotated at 1MB (one rotation kept as `scrollback.log.1`).
  - `~/.dancode/projects/<slug>/layout.json` — `{ terminals: [{id, cwd, command, claudeSessionId, background}], openFiles: [{path, pane, scrollTop}], splits: <tree> }`.
  - `~/.dancode/credentials.json`, `~/.dancode/sessions.json` — unchanged.
- **Key models**: `Project`, `Terminal`, `Layout`, `Session`. Layout is per-project, owned by the server. Terminal meta is owned by shellhost. Server and shellhost both read meta; only shellhost writes it.
- **Process supervision**: shellhost is the source of truth for "what terminals exist." On server boot, server calls `list` against shellhost and reconciles. On shellhost boot, shellhost scans `~/.dancode/terminals/` for orphaned meta (PTY no longer alive) and marks them as needing respawn.
- **TERM**: every PTY spawned with `TERM=xterm-256color`. No translation layer.

---

## Initial Setup (Human Required)

One-time setup, performed once per machine before the test suite or production install runs. **None of these steps are repeated during normal development or test runs.**

- Install Node 20+ (`nvm install 20` or distro package).
- Install build deps for node-pty: `python3`, `make`, `g++` (Debian/RPi: `sudo apt install build-essential python3`).
- Install Playwright browsers: `npx playwright install chromium` (one-shot; CI caches this).
- Ensure a `systemd --user` session is available (`systemctl --user status` returns 0). On the Pi: `loginctl enable-linger $USER` so user services survive logout.
- For the Phase 9 migration tests only: install `tmux` (`sudo apt install tmux`). After Phase 9 ships, tmux is no longer required.
- Clone the repo and run `npm install` at the root.

Verification: `npm run check:setup` (added in Phase 1) inspects the environment and prints a green/red status for each prerequisite. CI runs this as a pre-flight gate.

---

## System Tools and External Dependencies

Tools and external services the system uses, with usage scope.

| Tool | Used by | Setup or per-run | Purpose |
|------|---------|------------------|---------|
| Node.js 20+ | All workspaces | one-time | Runtime |
| node-pty (npm) | shellhost | per-run (installed via npm) | PTY ownership |
| Vitest | all workspaces | per-run | Unit + integration tests |
| Playwright + Chromium | client | one-time browser install, per-run execution | Headless browser E2E |
| `systemd --user` session | shellhost (prod), Phase 8 + Phase 10 tests | one-time | Process supervision; background-mode wrapping |
| `systemd-run --user --scope` | Phase 8 | per-run | Wrapping background terminals |
| `systemctl --user` | Phase 5, 8, 10 tests | per-run (invoked by tests) | Restart/inspect units |
| `ps` | Phase 3, Phase 7 | per-run | Process / foreground inspection |
| `machinectl shell` *(only if needed in Phase 8)* | Phase 8 | per-run | Re-attaching to background scopes |
| UNIX socket (filesystem) | server ↔ shellhost | per-run | RPC transport |
| `tmux` | Phase 9 migration tests only | one-time, **removed after Phase 9** | Source data for migration |
| `~/.claude/projects/<slug>/*.jsonl` (filesystem) | Phase 7 | per-run (read-only) | Claude session id source |

No third-party network services. No database. All persistence is filesystem-only under `~/.dancode/`.

---

## Testing Strategy

Three layers, all automated:

1. **Unit tests (Vitest)** — Run in each workspace's `tests/` directory. Cover pure logic: scrollback rotation math, layout JSON schema validation, wire-protocol framing/parsing, path-traversal rejection, Claude session-id parsing from filesystem.
   - Target: ≥85% line coverage in the `shellhost` workspace; ≥80% in the new server code added by this plan. Coverage is informational, not gating (avoid coverage-driven hollow tests).
2. **Integration tests (Vitest + real shellhost)** — Each phase that touches shellhost includes an integration test that boots a real shellhost subprocess on a temp UNIX socket, exercises the wire protocol with a test client, and asserts observable behavior. These cover: spawn/attach/kill, scrollback persistence + replay, server-restart survival, shellhost-restart respawn, background-mode survival across shellhost kill, tmux migration script against fixture tmux sessions.
3. **Browser E2E (Playwright headless Chromium)** — Per-phase E2E tests boot `npm run dev` (or a slimmed equivalent), drive the UI, and assert DOM/network outcomes. These cover: paste-once behavior, browser-refresh scrollback replay, layout restore on project reopen, CodeMirror save flows (Ctrl+S + on-blur), "Resume Claude" button behavior. Tests use Playwright's `page.keyboard.press('Control+S')` etc. — no human input.

**Test runner commands**:
- `npm test` — runs all three layers across all workspaces.
- `npm test -w shellhost`, `-w server`, `-w client` — per-workspace.
- `npm run test:e2e` — Playwright only.
- `npm run check:setup` — environment preflight (no actual tests, just verifies tools are present).

**Coverage targets**:
- Shellhost: ≥85% lines.
- Server (new code added by this plan): ≥80% lines.
- Client (CodeMirror integration + layout persistence UI): ≥75% lines.
- E2E flows: cover at least the acceptance-criteria smoke flow for each phase.

**Intentionally NOT tested**:
- node-pty's own internals (trusted dependency).
- xterm.js rendering correctness (trusted dependency; we only test that input/output bytes round-trip).
- Performance under load > 10 concurrent terminals (out of scope — single-user IDE).
- Cross-OS portability — Linux-only.
- Pi power-loss scenarios (literally untestable in CI; covered by simulating shellhost restart, which exercises the same recovery code path).

**Zero human steps during test runs.** Every acceptance criterion in every phase below is automated. The Phase 10 "production install on the Pi" walkthrough is a documentation deliverable, not a test step — its validation is automated via a containerized systemd-in-Docker run in CI.

---

## Deployment

DanCode is self-hosted; "deployment" means installing on the user's Pi (or any Linux box with systemd-user).

**Deploy pipeline (per release)**:
1. Run full test suite: `npm test`. Must be green.
2. Tag the commit (`git tag v0.X`, push tag).
3. On the target Pi: `cd /path/to/DanCode && git pull && npm install`.
4. Restart shellhost: `systemctl --user restart dancode-shellhost`. Shellhost recovery (Phase 5) re-spawns terminals on next project open.
5. Restart web server (if running under systemd): `systemctl --user restart dancode-server`. Otherwise just re-run `npm run dev` / `npm run start`.
6. Run post-deploy health check (automated; see below).

**Post-deploy verification (automated)**:
- `bin/dancode-healthcheck` — a script that: (a) confirms the shellhost socket is reachable, (b) issues a `list` op and asserts a response, (c) spawns a throwaway PTY (`echo healthcheck`) and asserts the output is received and the PTY exits 0, (d) confirms the dancode-server HTTP endpoint responds to `/api/auth/setup/status`.
- Run as part of the deploy step. Non-zero exit fails the deploy.

**Rollback**:
- Code rollback: `git checkout <previous-tag> && npm install`. Re-run the deploy steps above (restart units, health check).
- Data rollback: on-disk format changes within this plan are forward-compatible additions only (new fields default to safe values when missing). Rolling back to a prior tag is safe as long as no schema-breaking changes were introduced after that tag (call-out: phase 4 introduces `layout.json`; older code ignores it, so rollback to pre-phase-4 simply means the layout doesn't restore — terminals are still alive).
- In-flight PTY handling on rollback: rolling back the shellhost binary triggers a `systemctl --user restart`, which kills running PTYs in the old binary. After restart with the older binary, terminals are recovered via Phase 5 respawn semantics (which exist in any version ≥ Phase 5). Pre-Phase-5 rollback means terminals are lost on restart — same as today's tmux-less baseline.
- The deploy pipeline keeps the previous tag's `node_modules` and code intact under `~/.dancode/releases/<tag>/` for fast rollback (`ln -sfn ~/.dancode/releases/<tag> ~/.dancode/current`).

---

## Phase sequencing & parallelism

- **Phases 1 → 5 are strictly sequential.** Each depends directly on the previous one's data structures and runtime behavior:
  - Phase 2 (scrollback) needs Phase 1's shellhost + wire protocol to write through.
  - Phase 3 (server-restart survival) needs Phase 1's shellhost and Phase 2's scrollback (replay covers the restart gap).
  - Phase 4 (layout persistence) needs Phase 3's terminal-list recovery so layout can reference live terminals.
  - Phase 5 (Pi-reboot recovery) needs Phase 4's layout (the respawn list comes from it) and Phase 2's scrollback (banner content).
- **Phases 6, 7, 8 are independent of each other** and run in parallel after Phase 5 (marked with `<!-- PARALLEL 6,7,8 -->`). Phase 6 touches client editor only; Phase 7 touches shellhost process introspection + terminal-pane UI; Phase 8 touches shellhost spawn flow + a small UI toggle. No shared mutations.
- **Phases 9 and 10 are also independent** of each other and run in parallel after Phase 8 (marked with `<!-- PARALLEL 9,10 -->`). Phase 9 (tmux migration + code removal) touches the migration script and the legacy code paths; Phase 10 (systemd unit + production wiring) touches packaging and ops. Neither modifies the other's surface.

---

## Human-in-the-Loop Policy

**Test runs have zero human steps.** Every acceptance criterion below is verified by an automated test (unit, integration, or Playwright E2E) that an evaluator agent can execute via `npm test`, `npm run test:e2e`, or a phase-specific test script with no interactive input.

Human work is confined to:
- **Initial Setup** (above) — performed once per machine before testing.
- **Production install on a Pi** — Phase 10's documentation deliverable. Validation that the docs are correct is automated via a containerized systemd-in-Docker integration test.
- **Out-of-band confirmation by the project owner** — Dan may choose to manually try a real Pi reboot after Phase 5 to gain extra confidence. This is optional reassurance, not a phase acceptance gate.

---

## Phase 1: Shellhost MVP + web wiring
<!-- PHASE 1 COMPLETE -->

**Delivers**: A standalone `dancode-shellhost` Node process that owns PTYs and speaks the wire protocol over a UNIX socket. The DanCode server proxies a browser WebSocket end-to-end to a real PTY through shellhost. New terminals (created via `POST /api/terminals`) go through the new path; existing tmux-backed terminals are untouched but invisible until Phase 9. A user can open a project, click "New Terminal", and get a working shell with input/output/resize that survives a browser refresh (but not a server restart yet — that's Phase 3).

**Acceptance criteria**:
- A new `shellhost/` workspace exists with its own `package.json`, entrypoint, and Vitest tests.
- `npm run dev` at the repo root starts three concurrent processes: shellhost, server, client.
- Shellhost listens on `~/.dancode/shellhost.sock` (configurable via `DANCODE_SHELLHOST_SOCKET` env var).
- The wire protocol supports at least: `spawn`, `attach`, `detach`, `write`, `resize`, `kill`, `list`. Each command is unit-tested.
- `spawn` accepts `{ projectSlug, cwd, command }` and returns `{ terminalId }`. The PTY is launched via node-pty with `TERM=xterm-256color`.
- The server proxies a WebSocket `/terminal/:id` namespace by issuing `attach` to shellhost and bidirectionally forwarding bytes (`output` event → socket, socket `input` → `write` op).
- `POST /api/terminals` calls shellhost's `spawn`; `DELETE /api/terminals/:id` calls `kill`.
- Browser-side: opening a project → creating a terminal → typing commands → seeing output works end-to-end through the new backend (zero tmux involvement for new terminals).
- Paste of plain text into a terminal emits exactly once (no double paste).
- Integration test boots a real shellhost on a temp socket, spawns a `bash -lc 'echo hi'` PTY, attaches via a test client, asserts `hi\n` is received, and asserts the PTY exits cleanly with code 0.
- Playwright E2E: open the app, log in (test fixture credentials), create a project, create a terminal, send `printf hello\n` via xterm-driven input, assert `hello` appears in the rendered terminal DOM, paste a fixture string via `page.keyboard.press('Control+V')` after seeding the clipboard, assert it appears exactly once (no duplication).
- Adds `npm run check:setup` script that verifies Node version, build deps, and socket-dir writability; exits 0 only if all green.
- All existing passing tests still pass.

**AI opportunity**: None for this phase — backend plumbing.

---

## Phase 2: Disk-persisted scrollback

**Delivers**: Every PTY's output is appended to `~/.dancode/terminals/<id>/scrollback.log` as it streams. The log rotates at 1MB (one rotation kept). When a browser reconnects to a still-alive PTY, the last ~50KB of scrollback is replayed before live output resumes — and the replay comes from disk, not from a server-memory ring buffer. After this phase, a browser refresh on a noisy terminal shows the full recent history, not just what's in RAM.

**Acceptance criteria**:
- Shellhost writes every PTY output chunk to `scrollback.log` synchronously (write-through, no batching that risks loss).
- When `scrollback.log` reaches 1MB it is renamed to `scrollback.log.1` (overwriting any prior rotation) and a fresh `scrollback.log` is started. No more than two log files per terminal ever exist on disk.
- On `attach`, shellhost streams the tail of scrollback to the new attacher (last ~50KB across both rotation files, in chronological order) before forwarding live output.
- Unit tests cover: append, rotation boundary, multi-attach replay, attach to a terminal mid-rotation, attach to a terminal with no prior output (empty replay).
- The server-side in-memory ring buffer in `terminal-manager.js` is removed for new-backend terminals (deferred replay to shellhost).
- Playwright E2E: spawn a PTY that emits >100KB of output (`yes | head -c 120000`), wait for completion, reload the page, assert the rendered xterm DOM contains the last lines of the output (last ~50KB worth) and a known sentinel string from near the end. Run the reload twice in a row and assert no duplicate sentinels in the DOM (no replay duplication on reconnect).
- Integration test asserts disk usage: after writing exactly 2.5MB of output, exactly two files exist (`scrollback.log`, `scrollback.log.1`), total size ≤2.1MB (1MB + active file ≤ 1MB + small overhead).

**AI opportunity**: None — pure persistence.

---

## Phase 3: Survive web-server restart

**Delivers**: The DanCode server can be killed and restarted without affecting running PTYs. Shellhost keeps owning the PTYs; on startup the server calls `list` against shellhost and re-establishes its in-memory map of terminals. A browser that was connected during the restart auto-reconnects (existing Socket.IO behavior) and resumes the same PTY with no data loss beyond a brief stream gap (covered by Phase 2's replay).

**Acceptance criteria**:
- Integration test: spawn a PTY → record its node-pty child PID by querying shellhost `inspect` → kill the dancode-server process via `SIGTERM` → start a new server pointing at the same socket → query shellhost `inspect` again → assert the same PID is still running (`process.kill(pid, 0)` succeeds with no throw).
- On dancode-server startup, it calls `list` against shellhost and rebuilds its terminal map from the result.
- Playwright E2E: open a terminal, type a sentinel command (`echo step1`), kill the dancode-server subprocess (test orchestrates this via a `/test-only/kill-server` endpoint guarded behind `NODE_ENV=test`), wait for restart, send another command via the still-open WebSocket, assert both outputs appear in the DOM with no missing characters between them.
- Output produced while the server was down is replayed from scrollback on reconnect (asserted by injecting `echo $RANDOM` from inside the PTY during the gap via a side-channel and finding the value in the DOM after reconnect).
- The legacy `reconcile()` code path in `terminal-manager.js` is replaced by the new list-based recovery; tmux-resurrect race logic is now dead code (still present, removed in Phase 9).
- No data races: if shellhost emits an `output` event while the server is mid-restart, it's persisted to scrollback (verified by a stress test that writes 1MB of output during a forced restart cycle and asserts the full byte count appears in scrollback.log).

**AI opportunity**: None.

---

## Phase 4: Layout persistence + project restore

**Delivers**: Each project gets a `layout.json` describing its terminals (id, cwd, command, claudeSessionId, background), open files (path, pane index, scroll position), and split/tab structure. The server writes this file atomically (write to temp, fsync, rename) every time the layout changes. When a project is opened, the server reads `layout.json` and reconstructs the workspace UI — including which files were open, which terminal was focused, and the split layout. Missing files surface as a yellow warning banner ("File X no longer exists"), not a crash.

**Acceptance criteria**:
- `GET /api/projects/:slug/layout` returns the saved layout or a default empty layout if none exists.
- `PUT /api/projects/:slug/layout` accepts a layout payload, validates the schema, and writes it atomically (write to `layout.json.tmp`, fsync, rename).
- **Concurrency test**: 20 parallel `PUT` requests with distinct payloads complete without producing a torn file (post-test JSON.parse of `layout.json` succeeds AND its contents match exactly one of the 20 inputs). Implemented as a Vitest integration test.
- The layout schema is documented in `docs/layout-schema.md` and enforced server-side via a JSON-schema validator. Unknown fields are rejected with HTTP 400.
- Client writes layout changes whenever: a terminal is added/closed/moved, a file is opened/closed, a split is added/removed/resized, the focused pane changes, or a file's scroll position changes (debounced 500ms).
- Playwright E2E: open a project, spawn 2 terminals (different cwds), open 1 file, create a vertical split, log out, log back in, open the same project, assert: 2 terminals visible with their cwds preserved (`pwd` in each matches the original), the file is open in the correct pane, the vertical split exists.
- Playwright E2E: open a project that references a file in `layout.json` that has been deleted on disk → assert a `[data-testid="missing-file-warning"]` banner appears in that pane and the project still loads; assert clicking the banner's Close button removes it and updates `layout.json`.
- Renaming a project (`PATCH /api/projects/:slug`) updates the slug AND moves `~/.dancode/projects/<slug>/` to the new slug directory. Integration test asserts the new directory exists and the old one does not. Closes the known [[project_rename_bug]].
- Unit tests cover: atomic write under concurrent calls (see above), schema rejection of malformed payloads, layout round-trip, missing-file warning generation, project rename moves the layout directory.

**AI opportunity**: A `description` field is reserved in the layout schema for future AI summarization. **Out of scope for this phase** — schema field is declared as optional but the plan does not require any code that writes to it.

---

## Phase 5: Pi-reboot recovery (respawn with scrollback banner)

**Delivers**: After the shellhost itself restarts (simulating a Pi reboot via `systemctl --user restart dancode-shellhost`), all known terminals are recoverable. On project open, the server asks shellhost for each terminal in the layout; if the PTY is no longer alive, shellhost re-spawns it at the saved cwd with the saved startup command, prepends a visible banner (`--- prior session ended at <timestamp> ---`) to the new PTY's output buffer using the persisted scrollback, and live output begins. This is the functional equivalent of tmux-resurrect, without tmux.

**Acceptance criteria**:
- On shellhost startup, it scans `~/.dancode/terminals/*/meta.json` and marks each terminal as `state: 'needs-respawn'` (PTY not alive yet).
- A new wire op `respawn` (or `attach` with auto-respawn flag) causes shellhost to launch a fresh PTY at `meta.cwd` running `meta.command` (default: user's login shell), and emit a synthetic output chunk to attached clients: `\r\n\x1b[33m--- prior session ended at <ISO timestamp> ---\x1b[0m\r\n`.
- Before the banner, the most recent ~50KB of the prior scrollback is replayed (so the user sees what was on screen when the session died).
- After the banner, output from the freshly-spawned PTY streams normally and is written to the same `scrollback.log` (appended, not truncated — so history is preserved across respawns).
- Killing the shellhost (`kill <pid>` or `systemctl --user restart`) and restarting it leaves all terminals in `needs-respawn`. Opening a project triggers respawn for each terminal in its layout.
- Integration test: spawn PTY → write known sentinel output (`echo step-A; pwd > /tmp/cwd-marker`) → kill shellhost process via `SIGKILL` → start fresh shellhost on the same socket → server requests respawn for the terminal → assert: new PTY child exists with a different PID, scrollback log on disk still contains `step-A`, banner output `--- prior session ended at` is emitted to attached clients before live output, the new shell's working directory matches the original (`pwd` in the new PTY returns the saved cwd).
- A terminal's `meta.json` records `lastActiveAt` updated periodically (every 60s while attached) so the banner timestamp is accurate. Unit test asserts the field is updated within 65s of an active stream.
- Playwright E2E (full reboot simulation): spawn 2 terminals in a project, write distinct sentinel outputs to each, trigger shellhost restart via a `NODE_ENV=test`-guarded `/test-only/restart-shellhost` endpoint, reload the project page, assert both terminals appear, assert each banner is visible in its DOM, assert the prior sentinel output is in each terminal's scrollback DOM.

**AI opportunity**: **Out of scope for this phase.** A future enhancement could summarize prior sessions in the banner, but no acceptance criterion requires it.

---

<!-- PARALLEL 6,7,8 -->

## Phase 6: CodeMirror 6 editor

**Delivers**: The current text-only file viewer is replaced with a CodeMirror 6 editor. Files open with syntax highlighting for the major languages used in the project. Standard editing affordances (find/replace, undo/redo, multi-cursor, line numbers) work. Save is explicit (Ctrl+S) and automatic on blur. Path safety is enforced server-side.

**Acceptance criteria**:
- CodeMirror 6 is added as a client dependency. Language packages installed for: JavaScript/TypeScript (with JSX/TSX), Python, JSON, Markdown, YAML, Bash, HTML, CSS.
- Opening a file in the editor renders with the correct language mode based on file extension. Files with unknown extensions open in plain-text mode.
- Find (Ctrl+F) and replace (Ctrl+H) work via CodeMirror's built-in search panel.
- Undo (Ctrl+Z) and redo (Ctrl+Shift+Z / Ctrl+Y) work.
- Multi-cursor: Alt+Click adds a cursor; Ctrl+D selects next occurrence.
- Line numbers always visible.
- Ctrl+S saves immediately. Blurring the editor pane saves. Both go through `PUT /api/projects/:slug/files/*`.
- Server validates the file path is inside the project root before writing (rejects `..` traversal and absolute paths outside the project). Integration test attempts to PUT `../../etc/passwd` and asserts HTTP 403.
- **Editor latency**: Playwright performance test types 100 characters into a 1MB fixture file and measures `performance.mark`-bracketed keystroke-to-paint latency via `page.evaluate`. **p95 keystroke-to-paint latency < 50ms** on the CI runner; **p99 < 100ms**. Test fails if exceeded. (Pi-5 hardware perf is verified out-of-band by the project owner; CI numbers are a proxy floor.)
- Client tests cover: language detection per extension, save on Ctrl+S, save on blur, undo/redo round-trip, find panel opens.
- Playwright E2E: for each of `.ts`, `.py`, `.md`, `.json`, `.yaml`, `.sh`, `.html`, `.css` fixtures: open the file, assert at least one `.cm-keyword` (or language-specific token class) element is rendered, type an edit, press Ctrl+S, reload the page, re-open the file, assert the edit persisted.

**AI opportunity**: **Out of scope for this phase.** Reserved for a future "Ask AI to edit" command; no acceptance criterion in this phase requires it.

---

## Phase 7: Claude-aware resume

**Delivers**: When a terminal is running `claude`, DanCode detects it and persists the active session id to the terminal's `meta.json`. After a Pi reboot / shellhost restart, the respawn (Phase 5) uses `claude --resume <session-id>` instead of a bare shell, so the conversation continues. A "Resume Claude" button on the terminal pane offers manual resume of the most recent session for that project.

**Acceptance criteria**:
- Shellhost periodically (every 5s) inspects each PTY's foreground process via `ps` on the PTY's controlling tty. When the foreground process is `claude` (or `node …/claude.js`), the terminal is marked Claude-active.
- When Claude-active, shellhost scans `~/.claude/projects/<project-slug>/*.jsonl` for the most recently modified file and records its session id (filename without extension) into `meta.claudeSessionId`.
- A new wire op `noteClaudeSession` writes the session id atomically to `meta.json`.
- On Phase-5 respawn, if `meta.claudeSessionId` is set and `meta.command` is a Claude command, the spawn command becomes `claude --resume <claudeSessionId>`.
- Client: a "Resume Claude" button appears on a terminal pane when the pane has a recorded `claudeSessionId` and the terminal is currently NOT running Claude (i.e., user is at a shell prompt). Clicking it types the resume command and presses Enter.
- The "Resume Claude" button is dismissable per-terminal.
- **False-positive test**: run shellhost with 5 idle bash terminals (no `claude` invoked) for 5 minutes of accelerated test time (clock-mocked or scaled-down inspection interval). Assert no terminal is ever marked Claude-active. (Test scales the 30-minute requirement to 5 minutes via the same inspection logic — the property under test is "any bash idle session never gets misidentified," not the duration.)
- **CPU budget**: integration test runs shellhost with 5 active Claude-detection terminals for 60 seconds. Measures shellhost CPU via `/proc/<shellhost-pid>/stat` (utime+stime delta) before/after. Assert: cumulative inspection-loop CPU usage < 600ms over the 60s window (= < 1% sustained). Inspection interval (5s) and `ps` invocation cost are the only variables; if the test fails the implementation must batch or use `procfs` directly.
- Unit tests cover: foreground-process detection (mock `ps` output), session-id parsing from `~/.claude/projects/<slug>/` (fixture jsonl files), respawn command construction (assert `claude --resume <id>` shape).
- Integration test (full flow): spawn a fake-claude binary in a PTY that creates a `~/.claude/projects/test-slug/<uuid>.jsonl` file → assert `meta.claudeSessionId` is populated within 10s → restart shellhost → assert the respawn command for that terminal becomes `claude --resume <uuid>`.
- Playwright E2E: with a Claude session recorded (fixture sets up meta.claudeSessionId), assert the `[data-testid="resume-claude"]` button is visible on the terminal pane; click it; assert the corresponding `claude --resume <id>` text is sent to the terminal (visible in xterm DOM).

**AI opportunity**: This phase IS the AI integration — it makes the DanCode → Claude Code loop tight enough that the editor and AI assistant feel like one tool.

---

## Phase 8: Background mode

**Delivers**: Each terminal has an opt-in "background mode" toggle. When enabled, the command is wrapped in `systemd-run --user --scope --unit=dancode-bg-<terminalId>` so it runs as a transient systemd unit. The shell still appears in DanCode normally (stdio piped through shellhost), but if shellhost dies or is restarted, the underlying process keeps running and re-attaches on shellhost recovery. Intended for long jobs: builds, training runs, file syncs.

**Acceptance criteria**:
- `POST /api/terminals` accepts an optional `background: true` flag at creation time.
- `POST /api/terminals/:id/background` toggles the flag on an existing terminal (sets the flag in meta; takes effect on next respawn).
- When `background: true`, shellhost spawns the PTY's command via `systemd-run --user --scope --pty --unit=dancode-bg-<terminalId> -- <command>`.
- Killing the shellhost while a background terminal is running: the underlying `systemd-run` scope continues. After shellhost restarts, the next `attach` connects to the still-running scope (using `machinectl shell` or by attaching to the unit's stdio).
- A `kill` op on a background terminal stops the systemd scope (`systemctl --user stop dancode-bg-<id>`).
- The client UI shows a small badge on background-mode terminals.
- Integration test: spawn a background terminal running `sleep 30 && echo done > /tmp/bg-marker` → kill shellhost mid-sleep → restart shellhost → wait 30s → `/tmp/bg-marker` exists. (Test fixture cleans up the file.)
- Unit tests cover: background flag toggle, command wrapping correctness, kill propagation to systemd scope.
- Documentation: `docs/background-mode.md` explains the feature and when to use it.

**AI opportunity**: None.

---

<!-- PARALLEL 9,10 -->

## Phase 9: tmux migration script + tmux code removal

**Delivers**: A `bin/dancode-migrate-from-tmux` script captures the current state of any `dancode-*` tmux sessions and converts them into the new on-disk format. After the script runs, the legacy tmux backend code is removed from the codebase — `server/src/tmux.js`, the reconcile race logic in `terminal-manager.js`, `recover-terminals.mjs`, tmux mentions in `package.json` system-deps docs, and tmux-resurrect/-continuum references — leaving only the new shellhost path.

**Acceptance criteria**:
- `bin/dancode-migrate-from-tmux` is a Node script executable directly. Idempotent: running it twice produces the same result.
- For each `dancode-*` tmux session:
  - Extracts the project slug and terminal id from the session name.
  - Captures pane scrollback via `tmux capture-pane -p -S - -t <session>` and writes it to `~/.dancode/terminals/<id>/scrollback.log`.
  - Extracts cwd via `tmux display -t <session> -p '#{pane_current_path}'` and writes meta.json with `cwd`, `projectSlug`, `command: process.env.SHELL || '/bin/bash'`.
  - Adds the terminal id to the matching project's `layout.json` (creating one if absent).
- After successful migration, the script kills the tmux sessions (`tmux kill-session -t <name>`).
- The script prints a summary: `Migrated N terminals across M projects. Killed N tmux sessions. Removed K stale legacy files.`
- After the migration code lands, a follow-up commit removes:
  - `server/src/tmux.js`
  - All tmux-related imports, the reconcile retry/race logic, and the `tmuxSessionName` field from terminal-manager.
  - `recover-terminals.mjs` (no longer needed).
  - `tmux` from system-dependencies sections in `README.md` and `PROJECT_STRUCTURE.md`.
  - `tmux-resurrect` / `tmux-continuum` mentions in docs.
- A grep for `tmux` in the repo (excluding `node_modules`, the migration script itself, and historical commit messages) returns zero matches in production code.
- Existing Vitest tests for tmux-specific code are deleted; tests for terminal recovery via shellhost (Phase 3, 5) cover the new behavior.
- Integration test (full migration): set up 3 `dancode-fixture-*` tmux sessions in a CI tmux server with known cwds and pane contents (via `tmux new-session -d` + `tmux send-keys`) → run the migration script → assert: 3 `~/.dancode/terminals/<id>/meta.json` files exist with correct cwds; 3 scrollback.log files contain the pre-captured pane contents; the corresponding `~/.dancode/projects/<slug>/layout.json` files list the new terminal ids; the 3 tmux sessions are killed (`tmux has-session` returns non-zero). Re-run the script and assert idempotence (no new files created, no errors).

**AI opportunity**: None.

---

## Phase 10: systemd --user unit + production wiring

**Delivers**: `dancode-shellhost.service` is shipped as a `systemd --user` unit file in the repo. The README documents `systemctl --user enable --now dancode-shellhost` as the production install step (alongside enabling `loginctl enable-linger` so the unit survives logout). The `npm run dev` script still works for local development (launches its own shellhost on a different socket so it doesn't fight the systemd-managed one).

**Acceptance criteria**:
- A `systemd/dancode-shellhost.service` file exists in the repo with `Type=simple`, `Restart=on-failure`, `ExecStart=/usr/bin/env node /path/to/dancode-shellhost/index.js`, and `Environment=DANCODE_SHELLHOST_SOCKET=%h/.dancode/shellhost.sock`.
- The unit can be installed with: `mkdir -p ~/.config/systemd/user && cp systemd/dancode-shellhost.service ~/.config/systemd/user/ && systemctl --user daemon-reload && systemctl --user enable --now dancode-shellhost`.
- `loginctl enable-linger $USER` is documented in the README so the user service survives logout / runs after Pi reboot.
- `npm run dev` continues to start shellhost on a dev socket (`/tmp/dancode-shellhost-dev.sock`) so it doesn't conflict with the systemd-managed prod socket. Dev server uses the dev socket via env var.
- README has a "Production install on the Pi" section walking through: clone repo, `npm install`, install systemd unit, enable linger, start dancode-server (either via another systemd unit or `npm run start`).
- **Automated systemd integration test**: a CI job runs a `systemd-in-Docker` container (`jrei/systemd-debian` or equivalent), performs the README-documented install steps via a shell script, runs `bin/dancode-healthcheck`, asserts the unit is `active`, kills the shellhost process via `kill <pid>` (simulating a crash), asserts systemd auto-restarts it within 5 seconds, runs the healthcheck again, asserts it passes. This validates the unit file AND the documented install procedure with zero human steps.
- **Reboot-equivalent test**: in the same container, `systemctl --user stop dancode-shellhost && systemctl --user start dancode-shellhost`, then drive an HTTP API call to open a fixture project, assert previously-existing terminals respawn (covered by Phase 5 semantics).
- Optional: a sibling `systemd/dancode-server.service` for users who want the web server under systemd too. Stretch — README documents `npm run start` as the no-systemd path.

**AI opportunity**: None.
