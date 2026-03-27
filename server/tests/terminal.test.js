import { describe, it, expect } from 'vitest';

// terminal.js (legacy tmux terminal namespace) was replaced in Phase 2
// by TerminalManager + per-terminal WebSocket namespace in terminal-manager.js.
// See terminal-manager.test.js for the current terminal tests.

describe('terminal.js (replaced in Phase 2)', () => {
  it('module exists and is importable', async () => {
    const mod = await import('../src/terminal.js');
    expect(mod).toBeDefined();
  });
});
