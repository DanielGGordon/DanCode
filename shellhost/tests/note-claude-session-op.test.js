import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PTYManager } from '../src/pty-manager.js';
import { ScrollbackStore } from '../src/scrollback.js';
import { MetaStore } from '../src/meta-store.js';
import { handleFrame } from '../src/server.js';
import { makeRequest } from '../src/wire.js';

function makeFakeSpawn() {
  const created = [];
  const spawn = (file, args, opts) => {
    const dataListeners = new Set();
    const exitListeners = new Set();
    const fake = {
      pid: 5000 + created.length,
      ptsName: `/dev/pts/${10 + created.length}`,
      onData(cb) { dataListeners.add(cb); return { dispose() { dataListeners.delete(cb); } }; },
      onExit(cb) { exitListeners.add(cb); return { dispose() { exitListeners.delete(cb); } }; },
      write() {}, resize() {}, kill() {},
    };
    created.push({ file, args, opts, fake });
    return fake;
  };
  spawn.created = created;
  return spawn;
}

describe('noteClaudeSession op', () => {
  let baseDir;
  let manager, metaStore;

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'note-claude-'));
    const spawn = makeFakeSpawn();
    const scrollback = new ScrollbackStore({ baseDir });
    metaStore = new MetaStore({ baseDir });
    manager = new PTYManager({ spawn, scrollback, metaStore });
  });

  afterEach(async () => {
    try { manager.killAll(); } catch { /* ignore */ }
    if (baseDir) await rm(baseDir, { recursive: true, force: true });
  });

  async function dispatch(op, payload) {
    const sent = [];
    const ctx = { send: (f) => sent.push(f), attachments: new Map(), ptyManager: manager };
    await handleFrame(makeRequest('r1', op, payload), ctx);
    return sent.find((s) => s.type === 'res' && s.requestId === 'r1');
  }

  it('writes claudeSessionId atomically into meta.json', async () => {
    const m = manager.spawn({ projectSlug: 'demo', cwd: '/tmp', command: 'claude' });
    const res = await dispatch('noteClaudeSession', { terminalId: m.id, sessionId: 'sess-1' });
    expect(res.payload.ok).toBe(true);
    const meta = JSON.parse(await readFile(join(baseDir, m.id, 'meta.json'), 'utf8'));
    expect(meta.claudeSessionId).toBe('sess-1');
  });

  it('updates the in-memory record so subsequent inspect/list show the session id', async () => {
    const m = manager.spawn({ projectSlug: 'demo', cwd: '/tmp', command: 'claude' });
    await dispatch('noteClaudeSession', { terminalId: m.id, sessionId: 'sess-9' });
    expect(manager.inspect(m.id).claudeSessionId).toBe('sess-9');
  });

  it('errors when terminalId is missing', async () => {
    const res = await dispatch('noteClaudeSession', {});
    expect(res.payload.ok).toBe(false);
    expect(res.payload.error).toMatch(/terminalId/);
  });

  it('clearing the session id is allowed (sessionId === null)', async () => {
    const m = manager.spawn({ projectSlug: 'demo', cwd: '/tmp', command: 'claude' });
    await dispatch('noteClaudeSession', { terminalId: m.id, sessionId: 'sess-1' });
    await dispatch('noteClaudeSession', { terminalId: m.id, sessionId: null });
    const meta = JSON.parse(await readFile(join(baseDir, m.id, 'meta.json'), 'utf8'));
    expect(meta.claudeSessionId).toBeNull();
    expect(manager.inspect(m.id).claudeSessionId).toBeNull();
  });

  it('also works for a needs-respawn (orphan) terminal — updates meta only', async () => {
    await metaStore.write({ id: 'orphan', projectSlug: 'p', cwd: '/tmp', command: 'claude' });
    manager.loadOrphans();
    const res = await dispatch('noteClaudeSession', { terminalId: 'orphan', sessionId: 'sid' });
    expect(res.payload.ok).toBe(true);
    const meta = JSON.parse(await readFile(join(baseDir, 'orphan', 'meta.json'), 'utf8'));
    expect(meta.claudeSessionId).toBe('sid');
  });
});
