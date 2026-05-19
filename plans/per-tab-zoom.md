# Plan: Per-Tab Zoom

> Source: User request 2026-05-19 — "How hard would it be to be able to zoom only for a single tab? Example I have a file open in a tab and only want to zoom in on that file."

## Context

DanCode renders two kinds of tab content: code-file tabs (CodeMirror 6) and terminal tabs (xterm.js). The browser's native `Ctrl/Cmd +/-` zooms the entire viewport, including the sidebar, header, file tree, and every tab. The user wants to scale only the tab that has focus — for example, to make a single file readable on a phone or to enlarge one Claude terminal during pair-debugging without shrinking everything else.

Both rendering engines already expose per-instance sizing knobs (CM via a `font-size` theme reconfigured through a `Compartment`; xterm via the `fontSize` option plus a `FitAddon.fit()` reflow), so isolation is mechanically clean — the work is wiring keyboard handlers to the focused pane and persisting the chosen size so it survives reloads.

## Project config

- **Tech stack**: existing DanCode stack — Vite + React 19, CodeMirror 6 for file editing, xterm.js (with FitAddon) for terminals, Express + Socket.IO server, vitest for unit/integration, Playwright for E2E. No new runtime dependencies; both editor packages already ship the APIs we need.
- **Eval approach**: vitest unit tests against the new zoom helpers (pure functions: clamp, step, persistence) plus React Testing Library specs that simulate `keydown` events on the focused component and assert the rendered font-size / xterm options. A small Playwright spec covers the end-to-end "zoom one tab, switch tabs, switch back, size persists" path.
- **AI surface**: DanCode is itself an AI harness — every project ships a Claude terminal by default, so a user who wants to extend zoom (e.g. add `Ctrl+Shift+0` to fit-to-pane, or remember zoom by file *type* rather than path) can ask Claude in their own project terminal and have it edit the same codebase. No new AI endpoint needed for this feature.

## System tools and external dependencies

These are required for the test suite to run end-to-end. Provisioning is one-shot unless noted.

- **Node.js ≥ 22.12** (or 20.19 LTS) and **npm ≥ 10** — already declared in the repo's `package.json` engines field. Provisioned once per machine.
- **Project dependencies via `npm install`** at the repo root (workspaces install `client`, `server`, `shellhost`). Run once per checkout; re-run if `package-lock.json` changes.
- **Playwright browser binaries via `npx playwright install --with-deps chromium`**. Run once per machine, and again whenever Playwright is upgraded. Headless Chromium covers the only E2E target.
- **A running shellhost socket** — the existing `npm run dev` script provisions a dev shellhost at `/tmp/dancode-shellhost-dev.sock`. Required only for the Phase 2 Playwright spec; vitest specs use mocks and do not need a live shellhost.
- **localStorage support** — provided by jsdom (vitest) and Chromium (Playwright) automatically; no extra setup.

No new runtime dependencies are introduced by this feature.

## Initial Setup (Human Required)

There is no human-only setup step. After a fresh `git pull`, a developer or evaluator runs `npm install` and (once per machine) `npx playwright install --with-deps chromium`; from then on, every test run, eval, and zoom interaction is fully automated. The Ralph evaluator can execute the full suite — `npm test -w client`, `npm test -w server`, and `npx playwright test` — with no manual confirmations, prompts, or out-of-band configuration.

## Testing strategy

A normal evaluator run is fully automated: it executes `npm test -w client` (vitest, jsdom), `npm test -w server` (vitest, node), and `npx playwright test` (headless Chromium). No human steps are required during any test run.

- **Coverage target**: every acceptance criterion across both phases is exercised by at least one vitest spec or Playwright scenario. The clamp/persistence pure helpers should reach 100% branch coverage; UI specs assert observable behaviour (rendered font-size, xterm `fontSize` option, FitAddon `.fit()` invocation, shellhost resize message) rather than internal state.
- **Intentionally NOT tested** (out of scope for this feature):
  - Cross-browser parity beyond headless Chromium — Firefox/Safari/mobile Safari are not exercised.
  - Mobile touch pinch-to-zoom — only keyboard shortcuts are in scope.
  - Accessibility-tool zoom (Windows Magnifier, macOS Zoom) — these operate above the browser and are unaffected by the per-tab font-size knob.
  - High-DPI/Retina pixel-perfect rendering — font-size is integer px; sub-pixel fidelity is left to the browser.
  - Concurrent multi-tab BroadcastChannel sync — zoom is local to the browser tab/window viewing DanCode; if the same project is open in two browser tabs, each maintains its own zoom for the same file/terminal.

## Deployment

DanCode ships as a single Node process supervised by a user-level systemd unit (Phase 10 of the prior shellhost redesign). This feature is purely client-side except for nothing — no new server routes — so deployment is identical to any other client change.

- **Build**: `npm run build -w client` produces a static bundle in `client/dist/`. The server serves it via Express static middleware in production.
- **Deploy**: on the host (`danpi`), pull the new commit and run `systemctl --user restart dancode` (or the project's existing deploy script, if any). The static bundle is picked up by the server on restart; no database migrations, no socket changes, no shellhost change required.
- **Post-deploy verification (smoke test)**:
  1. Load the app in a browser, log in, open a file tab, press `Ctrl/Cmd +=`, confirm the file's font grew and the sidebar/header did not.
  2. Reload the page and confirm the file tab restored the larger size.
  3. Open a terminal tab, press `Ctrl/Cmd +=`, type `stty size` and confirm the reported rows/cols match the new geometry.
  4. The existing `/healthz`-style health check (or `curl -fsS http://localhost:3000/` returning 200) continues to pass.
- **Rollback**: revert the merge commit and run `systemctl --user restart dancode`. Because the feature only writes to `localStorage` (never to disk or the database) and adds no server routes, no rollback migration or data cleanup is needed — stale `dancode-zoom-file:*` / `dancode-zoom-terminal:*` keys in users' browsers are inert and self-clean as terminals are destroyed.

## Architectural decisions

- **Keybindings (shared by both phases)**:
  - `Ctrl/Cmd + =` (also accepts `Ctrl/Cmd + +` from shifted layouts) — zoom in one step.
  - `Ctrl/Cmd + -` — zoom out one step.
  - `Ctrl/Cmd + 0` — reset to the default size for that tab type.
  - Handlers `preventDefault()` only when the focused element is inside the zoomable pane; otherwise the browser's native zoom passes through unchanged.
- **Zoom range**:
  - File tabs: 8 px – 32 px, default 14 px, integer step of 1 px.
  - Terminal tabs: 8 px – 32 px, default 13 px, integer step of 1 px.
- **Persistence**:
  - File tabs: keyed by absolute file path within a project (`${projectSlug}:${filePath}`) in `localStorage` under `dancode-zoom-file:${key}`.
  - Terminal tabs: keyed by terminal id in `localStorage` under `dancode-zoom-terminal:${terminalId}`.
  - Missing/invalid keys fall back to the default; values outside the clamp range are coerced to the nearest valid step.
- **Focus model**: a pane is considered focused when `document.activeElement` is inside its DOM subtree. Both CodeMirror and xterm already manage their own focus rings; no new focus state needs to be added at the App level.
- **Reflow**: terminal tabs must call the existing xterm `FitAddon.fit()` (and propagate the new cols/rows to the shellhost via the existing resize channel) immediately after a font-size change so the running shell does not render against stale dimensions.

---

<!-- PARALLEL 1,2 -->

## Phase 1: File-tab zoom
<!-- PHASE 1 COMPLETE -->

**Delivers**: In any open file-editor tab, pressing `Ctrl/Cmd + =`, `Ctrl/Cmd + -`, or `Ctrl/Cmd + 0` changes the rendered font size of only that editor instance. Other open file tabs, the file tree, and the rest of the chrome are unaffected. The chosen size persists per file path across page reloads and project switches.

**Acceptance criteria**:
- With one file tab focused, `Ctrl/Cmd + =` increases that editor's content font size by one step and leaves every other file tab and the surrounding UI at the previous size.
- With one file tab focused, `Ctrl/Cmd + -` decreases that editor's content font size by one step, clamped at the configured minimum.
- With one file tab focused, `Ctrl/Cmd + 0` returns that editor to the configured default size.
- Zoom shortcuts have no effect (and do not `preventDefault`) when focus is outside any file editor — the browser's native page zoom still works on the rest of the app.
- Reloading the page restores each file tab to its previously chosen size, keyed by the project slug + file path.
- Opening the same file in a different project does not inherit zoom from another project.
- A vitest spec asserts the keymap handler dispatches the correct font-size effect for `=`, `-`, and `0` against a mocked CodeMirror view; another spec round-trips the persistence helper (clamp, write, read, default-on-miss).
- A Playwright spec opens two file tabs, zooms one, switches tabs, switches back, and verifies the zoomed tab still has its custom size while the other tab is at the default.

---

## Phase 2: Terminal-tab zoom (COMPLETE)
<!-- PHASE 2 COMPLETE -->

**Delivers**: In any open terminal pane, pressing `Ctrl/Cmd + =`, `Ctrl/Cmd + -`, or `Ctrl/Cmd + 0` changes the rendered font size of only that xterm instance, and the running shell immediately sees the new column/row geometry (commands like `top` or `htop` redraw correctly). The chosen size persists per terminal id across page reloads.

**Acceptance criteria**:
- With one terminal focused, `Ctrl/Cmd + =` increases that terminal's font size by one step; all other terminals retain their previous size.
- With one terminal focused, `Ctrl/Cmd + -` decreases the font size, clamped at the configured minimum.
- With one terminal focused, `Ctrl/Cmd + 0` returns that terminal to the configured default size.
- After every zoom change the terminal's `cols` and `rows` are recomputed and forwarded to shellhost over the existing resize wire format, so `stty size` inside the shell reports the new geometry.
- Zoom shortcuts have no effect when focus is outside any terminal pane.
- Reloading the page restores each terminal to its previously chosen size, keyed by terminal id.
- Destroying a terminal removes its persisted zoom entry so stale ids do not accumulate in `localStorage`.
- A vitest spec asserts the persistence helper round-trips correctly and clamps out-of-range values.
- A React Testing Library spec mounts the terminal component, simulates focus + zoom-in keydown, and verifies the xterm `setOption('fontSize', …)` plus the FitAddon `.fit()` call were both invoked.
- A Playwright spec opens two terminals in one project, zooms one, types `echo hi`, verifies output renders at the new size, switches to the other terminal, verifies it is still at the default size, reloads, and verifies the zoomed terminal restores its size.

**AI opportunity**: optional follow-up (not required to pass the phase) — surface a small "↻ default size" affordance in the terminal toolbar so a user who has zoomed many terminals can reset one without remembering `Ctrl/Cmd + 0`. A Claude terminal in the project itself can be asked to add it later.
