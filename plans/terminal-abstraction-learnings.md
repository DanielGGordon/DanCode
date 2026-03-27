# Learnings
# Ralph appends entries after each phase.

## [2026-03-27 05:16] Phase 2: Multi-Terminal Layout + Project Integration

The two failing criteria (17 and 18) shared a single root cause: the shared `e2e-helpers.js` login helper hard-crashed on `ENOENT` when `~/.dancode/e2e-password` was missing, unlike `terminal-poc.spec.js` which already had a try/catch fallback. Adding the same fallback pattern unblocked all 15 affected E2E tests. The `placeholder.spec.js` failure was a stale assertion from the pre-auth era — the server now serves the React client (login screen) instead of a static placeholder page. When migrating architecture across phases, E2E infrastructure files (helpers, fixtures) must be updated alongside the tests that use them, not just the test specs themselves.

## [2026-03-27] Phase 3: Reconnection UX & Polish

Socket.io auto-reconnection works well out of the box but requires careful coordination with xterm.js to avoid duplicate output on reconnect — the ring buffer replay from the server re-sends all buffered content, so the terminal must be cleared (`term.clear()` + `term.reset()`) before the replay to prevent doubling. React state updates within Socket.io event handlers are not synchronous, so a `stateRef` pattern (updating both ref and state together via a helper) is needed to ensure subsequent event handlers (e.g., `disconnect` fired immediately after `session-exit`) see the latest state. The E2E auth infrastructure remains broken — all E2E tests fail on login because `~/.dancode/e2e-password` doesn't exist and the fallback password is wrong; this needs a proper test credential setup before any E2E tests can validate Phase 3+ features.

## [2026-03-27 05:59] Phase 3: Reconnection UX & Polish

The E2E login helper must handle both fresh environments (no account exists) and existing environments (account set up with unknown password). The fix was to check `/api/auth/setup/status` first and create a test account if setup isn't complete, matching the pattern already used in terminal-poc.spec.js. Dead code in test files (no-op page.evaluate blocks left from iterative development) should be removed rather than left as commented-out attempts. When testing reconnection with ring buffer replay, the E2E test must assert that pre-disconnect output (BEFORE_DISCONNECT) is visible after reconnect, not just post-reconnect output — this is what actually proves the ring buffer replayed correctly.

## [2026-03-27] Phase 7: Mobile Terminal + Shortcut Bar

Converting Terminal.jsx from a default-export function to forwardRef requires updating both the function signature and the export statement — the old `export default function Terminal(...)` must become `const Terminal = forwardRef(function Terminal(..., ref) { ... })` with a separate `export default Terminal` at the end. Vitest's `vi.mock()` factory cannot reference top-level imports directly; when mocking a forwardRef component, use `async () => { const React = await import('react'); ... }` pattern to get React inside the factory. The `window.matchMedia` mock for test environments (jsdom) must be set in `beforeEach`, not at module scope, because `window` may not exist yet when the module initializes. For mobile keyboard detection, `window.visualViewport` provides reliable resize events — comparing `visualViewport.height` to `window.innerHeight` at a 0.75 ratio threshold detects keyboard open/close. Pinch-to-zoom on terminal requires `passive: false` on touchstart/touchmove to call `preventDefault()` and avoid browser zoom interference.
