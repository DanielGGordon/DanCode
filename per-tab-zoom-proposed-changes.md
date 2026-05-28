# Per-Tab Zoom — Proposed Changes

## After Phase 1 (proposed by Phase 1 generator)

- **localStorage shim in vitest.setup.js.** Node 22's experimental built-in `localStorage` shadows jsdom's working `Storage` and is unusable without `--localstorage-file`. Phase 1 added an in-memory shim to `client/vitest.setup.js` that overrides `globalThis.localStorage` and `window.localStorage` with a tiny `Map`-backed implementation. Phase 2 terminal-tab zoom tests can use `localStorage` directly in vitest without any additional mocking. Tests that need to start from a clean store should call `localStorage.clear()` in `beforeEach`.

- **Focus-gated keymap is trivial in CodeMirror, NOT in xterm.js.** Phase 1's "shortcuts have no effect when focus is outside the editor" criterion is automatically satisfied because CodeMirror routes keymap events only when the view's `contentDOM` has focus. For Phase 2, xterm.js does not expose a keymap; you'll need a different approach. Two viable options:
  1. Attach a `keydown` listener on the terminal pane's outer wrapper and short-circuit when `document.activeElement` is outside that wrapper. This matches the architectural decision in the plan ("a pane is considered focused when `document.activeElement` is inside its DOM subtree").
  2. Use xterm's `attachCustomKeyEventHandler(...)` to intercept keys before they reach the PTY, return `false` to swallow them when a zoom key is detected. This fires only when xterm has focus, so it gives you the same focus-gating for free.
  Option 2 is cleaner and consistent with how xterm wants you to handle host-level shortcuts. Either way, you'll need to `e.preventDefault()` only when the terminal is focused so the browser's native zoom still works on the rest of the app.

- **Reuse the zoom helper module shape.** `client/src/editor/zoom.js` is structured as pure helpers (`clamp`, `storageKey`, `read`, `write`, `clear`, `step`) plus a small set of exported constants. Mirror this for terminals — a sibling module like `client/src/terminal/zoom.js` with `TERMINAL_ZOOM_DEFAULT = 13`, `TERMINAL_ZOOM_MIN = 8`, `TERMINAL_ZOOM_MAX = 32`, storage prefix `dancode-zoom-terminal:<terminalId>`. The keymap module pattern (a `Compartment`-reconfigure for CM, an equivalent for xterm) can be kept side-by-side. Don't try to share generic code across the two surfaces — the API shapes diverge (`view.dispatch` + `Compartment.reconfigure` vs `xterm.options.fontSize` + `FitAddon.fit()`), and a forced abstraction will be more code than two parallel concrete modules.

- **Persisted zoom must be cleared on terminal destroy.** Phase 1 left `clearFileZoom` exported but only "stale ids self-clean as terminals are destroyed" is in the plan for terminals. The acceptance criterion is explicit: "Destroying a terminal removes its persisted zoom entry so stale ids do not accumulate in `localStorage`." Wire `clearTerminalZoom(terminalId)` into the existing `DELETE /api/terminals/:id` success branch on the client (it's a client-side concern — localStorage lives in the browser).

- **Playwright assertion uses computed font-size.** The Phase 1 E2E proves the zoom landed by reading `getComputedStyle(content).fontSize` on `.cm-content`. For Phase 2, the equivalent for xterm.js is the canvas/DOM that xterm renders into. xterm exposes `term.options.fontSize` synchronously, which is far easier to assert from a Playwright `page.evaluate(...)` than measuring computed style on the canvas. Expose the xterm instance on `window.__dancodeTerminals[id]` (mirroring `window.__dancodeCmView`) in test/dev builds.

- **Server-side resize wire is already in place.** The plan's "propagate cols/rows to shellhost over the existing resize channel" should reuse the `resize` Socket.IO op that the Terminal component already calls on viewport changes — no new wire format is needed. After `setOption('fontSize', n)` + `FitAddon.fit()`, read `term.cols` / `term.rows` and emit them on the same socket. The shellhost `resize` op accepts `{ cols, rows }`.

- **Test the "wide variety of layouts" Ctrl+= edge case.** Ctrl+Shift+= produces a `+` key event on US ANSI keyboards but a different code on AZERTY/Dvorak. Phase 1 handles this by binding both `Mod-=` and `Mod-+` in CodeMirror; do the same in the xterm pane's keydown listener (check `e.key === '=' || e.key === '+'`).

## After Phase 2 (proposed by Phase 2 generator)

- **jsdom 29 ships a stub `localStorage`** — the global is present but it's a
  plain Object without `setItem` / `getItem` / `clear`, so any client code that
  hits `localStorage` directly throws in unit tests. Phase 2 added a minimal
  in-memory polyfill at the top of `client/vitest.setup.js`. Future phases
  that touch persistence (file-tab zoom, layout state, etc.) inherit it for
  free — but if anyone bumps jsdom and the upstream provides a real Storage
  again, the `typeof window.localStorage?.setItem !== 'function'` guard will
  silently fall through to the real implementation.

- **Parallel-worktree port conflict on shellhost E2E** — the plan is marked
  `<!-- PARALLEL 1,2 -->` and both worktrees default to `SERVER_PORT=3102` /
  `CLIENT_PORT=5175` in `server/playwright.shellhost.config.js`. Running both
  phases' E2Es at the same time fails with "port already in use". The config
  already honors `DANCODE_E2E_SERVER_PORT` / `DANCODE_E2E_CLIENT_PORT` /
  `DANCODE_SHELLHOST_SOCKET`; the Ralph runner should set distinct values per
  worktree (e.g. `3102/5175` for phase 1, `3112/5185` for phase 2) before
  invoking Playwright. Phase 2 was verified end-to-end with the alternate
  ports; the spec itself is identical and the override is purely operational.

- **xterm v6 fontSize API** — the plan text mentions
  `term.setOption('fontSize', …)`, but xterm.js 6 removed `setOption()` and
  expects `term.options.fontSize = N`. The Phase 2 implementation and tests
  use the v6 form. If Phase 1 (file-tab zoom) reads the plan verbatim it may
  reach for a CodeMirror equivalent — for CM 6 the correct pattern is a
  `Compartment` reconfigure, not a setOption call.

- **Document-level capture-phase keydown is the only reliable way to
  intercept Ctrl/Cmd + =, -, 0 inside xterm.** xterm registers its own
  keydown listener on its hidden helper textarea and consumes anything the
  custom-key hook lets through. Phase 2 attaches at `document` with
  `capture: true` and bails unless `container.contains(document.activeElement)`,
  so multiple Terminal instances coexist (each one only zooms when it's the
  one with focus). The `attachCustomKeyEventHandler` callback ALSO returns
  false for zoom combos as a belt-and-suspenders measure so the key bytes
  never reach the PTY even if the document listener is ever unmounted.

- **Default font size drift** — the previous hard-coded default in
  `Terminal.jsx` was 14 px; the plan specifies 13 px. Phase 2 lowered the
  default to 13 to match the plan, and changed it via shared constants from
  `terminalZoom.js`. Any pixel-perfect screenshot baselines from before this
  commit will diff by 1 px line-height.
