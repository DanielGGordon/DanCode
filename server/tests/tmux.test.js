import { describe, it, expect } from 'vitest';

// tmux.js was emptied in Phase 2 (terminal abstraction).
// These tests are preserved as placeholders for Phase 4 when tmux
// is re-added as an invisible persistence layer.

describe('tmux.js (emptied in Phase 2)', () => {
  it('module exists and is importable', async () => {
    const mod = await import('../src/tmux.js');
    expect(mod).toBeDefined();
  });
});
