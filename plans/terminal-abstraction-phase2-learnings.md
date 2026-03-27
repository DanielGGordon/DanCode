# Phase 2 Learnings: Multi-Terminal Layout + Project Integration

## Execution summary

Phase 2 was completed across two sessions. Session 1 implemented all source code changes and Vitest test updates. Session 2 (continuation) completed Playwright E2E test updates, the new terminal-lifecycle E2E test, documentation updates, and the LoginScreen test fix.

### Commits (5 total)
1. `6ab149c` — Replace tmux-based terminal flow with TerminalManager + TerminalLayout
2. `6e6758a` — Update all Vitest tests for Phase 2 TerminalManager architecture
3. `d153b6f` — Update all Playwright E2E tests for Phase 2 TerminalManager architecture
4. `08606ef` — Update documentation for Phase 2 TerminalManager architecture
5. `7967ee2` — Fix LoginScreen tests for username/password + TOTP auth

### Final test results
- **Client Vitest**: 160/160 passed (7 test files)
- **Server Vitest**: 148/148 passed (6 test files)

---

## Learnings

### 1. Auth rewrite creates cascading test breakage
The auth rewrite (commit `4f479f2`, username/password + TOTP replacing static token) broke LoginScreen.test.jsx (6 tests) and all E2E tests that used the old `auth-token` file login flow. These pre-existing failures weren't caught because they happened in the same development cycle. **Takeaway**: When a foundational subsystem like auth changes, immediately update all tests that depend on it — don't leave them as "out of scope" for a later phase.

### 2. E2E shared helpers eliminate massive test duplication
Creating `e2e-helpers.js` with shared `login()`, `createProject()`, and `cleanupProject()` functions collapsed 15+ lines of duplicated setup code in each spec file. The login helper handles the full TOTP flow (reads credentials.json, generates TOTP code, calls API, injects token into localStorage). **Takeaway**: For E2E tests with complex auth flows, invest in a shared helper early — it pays off immediately.

### 3. jsdom keyboard events target `document`, not `window`
App.jsx uses `document.addEventListener('keydown', handler, true)` for Ctrl+K and Escape shortcuts. In jsdom, `fireEvent.keyDown(window, ...)` does NOT reach document listeners. Must use `fireEvent.keyDown(document, ...)`. This caused 6 App.test.jsx failures that looked unrelated to Phase 2 changes. **Takeaway**: Always dispatch keyboard events on `document` in jsdom tests when the handler is on `document`.

### 4. xterm.js mock must include all methods the component calls
Terminal.jsx calls `attachCustomKeyEventHandler`, `getSelection`, `clearSelection`, `paste`, and accesses `options` on the xterm Terminal instance. If the mock is missing any of these, all 27+ terminal tests fail with a single `TypeError`. **Takeaway**: When updating a mock for a real library, read the component's actual usage and ensure every accessed method/property is present.

### 5. LoginScreen phases require async test setup
The new LoginScreen fetches `/api/auth/setup/status` on mount to decide which phase to show (loading → setup | login). Tests that render LoginScreen must mock this endpoint and `await waitFor(() => ...)` for the form to appear. Synchronous assertions (like the old tests) always hit the "Loading..." state. **Takeaway**: Components with async initialization need async test patterns — you can't just render and assert.

### 6. terminal-poc.spec.js had wrong otplib import
The original test used `import { generate } from 'otplib'` which doesn't exist — the correct import is `import { authenticator } from 'otplib'` and then `authenticator.generate(secret)`. This test was written before the auth rewrite was fully integrated. **Takeaway**: Verify imports against the library's actual API, especially after upgrading auth libraries.

### 7. Scope of tmux removal
The plan said to "empty" tmux.js and terminal.js rather than delete them (preserving for Phase 4). This is the right call — Phase 4 will re-introduce tmux as an invisible persistence layer behind TerminalManager. The files serve as placeholders and their existing tests still pass (both have single placeholder tests).

### 8. TerminalLayout data-slug attribute for E2E assertions
E2E tests needed to verify which project is currently displayed. Adding `data-slug={slug}` to the TerminalLayout container div allowed tests to assert `await expect(page.getByTestId('terminal-layout')).toHaveAttribute('data-slug', slugA)` — a pattern matching what the old pane-layout used.

## Proposed changes for future phases

### Phase 3 (Reconnection UX)
- The current Terminal.jsx already has reconnect/session-exit overlays from the tmux era. These work with TerminalManager but could be enhanced with the connection state indicators (green/yellow/red dots) called for in Phase 3.
- Consider adding a `lastActivity` timestamp to terminal metadata during Phase 3, since Phase 6 (PWA) needs it for the dashboard activity indicators.

### Phase 4 (Invisible Tmux Persistence)
- The empty `tmux.js` is ready to be re-populated. The TerminalManager.create() method is the insertion point — it should spawn the PTY inside a tmux session instead of directly.
- Terminal metadata files should gain a `tmuxSessionName` field.
- The ring buffer replay can be supplemented by `tmux capture-pane` on server restart for cases where the in-memory buffer was lost.
