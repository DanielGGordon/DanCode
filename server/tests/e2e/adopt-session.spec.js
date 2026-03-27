import { test, expect } from '@playwright/test';

// Adopt-session flow was removed in Phase 2 (terminal abstraction).
// Projects no longer use tmux sessions — TerminalManager spawns PTY
// processes directly. This spec is preserved as a placeholder.

test('adopt-session flow removed in Phase 2', () => {
  expect(true).toBe(true);
});
