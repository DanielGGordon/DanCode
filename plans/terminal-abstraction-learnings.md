# Learnings
# Ralph appends entries after each phase.

## [2026-03-27 05:16] Phase 2: Multi-Terminal Layout + Project Integration

The two failing criteria (17 and 18) shared a single root cause: the shared `e2e-helpers.js` login helper hard-crashed on `ENOENT` when `~/.dancode/e2e-password` was missing, unlike `terminal-poc.spec.js` which already had a try/catch fallback. Adding the same fallback pattern unblocked all 15 affected E2E tests. The `placeholder.spec.js` failure was a stale assertion from the pre-auth era — the server now serves the React client (login screen) instead of a static placeholder page. When migrating architecture across phases, E2E infrastructure files (helpers, fixtures) must be updated alongside the tests that use them, not just the test specs themselves.

## [2026-03-27] Phase 3: Reconnection UX & Polish

Socket.io auto-reconnection works well out of the box but requires careful coordination with xterm.js to avoid duplicate output on reconnect — the ring buffer replay from the server re-sends all buffered content, so the terminal must be cleared (`term.clear()` + `term.reset()`) before the replay to prevent doubling. React state updates within Socket.io event handlers are not synchronous, so a `stateRef` pattern (updating both ref and state together via a helper) is needed to ensure subsequent event handlers (e.g., `disconnect` fired immediately after `session-exit`) see the latest state. The E2E auth infrastructure remains broken — all E2E tests fail on login because `~/.dancode/e2e-password` doesn't exist and the fallback password is wrong; this needs a proper test credential setup before any E2E tests can validate Phase 3+ features.
