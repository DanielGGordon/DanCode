import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PTYManager } from '../src/pty-manager.js';
import { ScrollbackStore } from '../src/scrollback.js';
import { MetaStore } from '../src/meta-store.js';
import { handleFrame } from '../src/server.js';
import { makeRequest } from '../src/wire.js';

/**
 * Tests for the Phase 5 respawn semantics. We use a fake spawn so we can
 * exercise lifecycle, banner emission, and scrollback append independently
 * of node-pty.
 */
function makeFakeSpawn() {
  const created = [];
  const spawn = (file, args, opts) => {
    const dataListeners = new Set();
    const exitListeners = new Set();
    const fake = {
      pid: 8000 + created.length,
      onData(cb) { dataListeners.add(cb); return { dispose() { dataListeners.delete(cb); } }; },
      onExit(cb) { exitListeners.add(cb); return { dispose() { exitListeners.delete(cb); } }; },
      write() {},
      resize() {},
      kill() { for (const f of exitListeners) f({ exitCode: 0, signal: null }); },
      __emit(d) { for (const f of dataListeners) f(d); },
    };
    created.push({ file, args, opts, fake });
    return fake;
  };
  spawn.created = created;
  return spawn;
}

async function setup(baseDir, opts = {}) {
  const spawn = makeFakeSpawn();
  const scrollback = new ScrollbackStore({ baseDir, maxBytes: 1_000_000, tailBytes: 50 * 1024 });
  const metaStore = new MetaStore({ baseDir });
  const manager = new PTYManager({ spawn, scrollback, metaStore, ...opts });
  const attachments = new Map();
  const sent = [];
  const ctx = { send: (f) => sent.push(f), attachments, ptyManager: manager };
  let nextRid = 1;
  const req = async (op, payload) => {
    const rid = `r${nextRid++}`;
    await handleFrame(makeRequest(rid, op, payload), ctx);
    return sent.find((s) => s.type === 'res' && s.requestId === rid);
  };
  return { spawn, scrollback, metaStore, manager, attachments, sent, ctx, req };
}

describe('PTYManager meta persistence', () => {
  let baseDir;
  let env;

  beforeEach(async () => { baseDir = await mkdtemp(join(tmpdir(), 'respawn-')); });
  afterEach(async () => {
    env?.scrollback?.closeAll();
    if (baseDir) await rm(baseDir, { recursive: true, force: true });
  });

  it('spawn writes meta.json with cwd/command/projectSlug to baseDir/<id>/', async () => {
    env = await setup(baseDir);
    const meta = env.manager.spawn({ projectSlug: 'p', cwd: '/tmp', command: 'sleep 5' });
    const path = join(baseDir, meta.id, 'meta.json');
    expect(existsSync(path)).toBe(true);
    const parsed = JSON.parse(await readFile(path, 'utf8'));
    expect(parsed.id).toBe(meta.id);
    expect(parsed.cwd).toBe('/tmp');
    expect(parsed.command).toBe('sleep 5');
    expect(parsed.projectSlug).toBe('p');
    expect(parsed.createdAt).toBeTruthy();
    expect(parsed.lastActiveAt).toBeTruthy();
  });

  it('loadOrphans populates terminals as needs-respawn (no PTY spawned)', async () => {
    env = await setup(baseDir);
    // Pre-seed two meta files as if shellhost had died and restarted.
    await env.metaStore.write({
      id: 'orphan-a',
      projectSlug: 'p',
      cwd: '/tmp',
      command: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      lastActiveAt: '2026-01-01T00:01:00.000Z',
    });
    await env.metaStore.write({
      id: 'orphan-b',
      projectSlug: 'q',
      cwd: '/var',
      command: 'echo hi',
      createdAt: '2026-01-01T00:00:00.000Z',
      lastActiveAt: '2026-01-01T00:01:00.000Z',
    });

    const result = env.manager.loadOrphans();
    expect(result.loaded).toBe(2);
    // No fake spawns happened.
    expect(env.spawn.created).toHaveLength(0);

    const list = env.manager.list();
    expect(list.map((t) => t.id).sort()).toEqual(['orphan-a', 'orphan-b']);
    for (const t of list) {
      expect(t.needsRespawn).toBe(true);
      expect(t.pid).toBeNull();
    }
  });

  it('list returns recovered (needs-respawn) terminals alongside live ones', async () => {
    env = await setup(baseDir);
    await env.metaStore.write({ id: 'orphan', projectSlug: 'p', cwd: '/tmp', command: null });
    env.manager.loadOrphans();

    const live = env.manager.spawn({ projectSlug: 'p', cwd: '/tmp', command: 'sleep 1' });
    const all = env.manager.list();
    expect(all.map((t) => t.id).sort()).toEqual([live.id, 'orphan'].sort());
    expect(all.find((t) => t.id === 'orphan').needsRespawn).toBe(true);
    expect(all.find((t) => t.id === live.id).needsRespawn).toBeFalsy();
  });
});

describe('respawn op', () => {
  let baseDir;
  let env;

  beforeEach(async () => { baseDir = await mkdtemp(join(tmpdir(), 'respawn-')); });
  afterEach(async () => {
    env?.scrollback?.closeAll();
    if (baseDir) await rm(baseDir, { recursive: true, force: true });
  });

  it('respawn launches a fresh PTY at meta.cwd/command and emits scrollback tail + banner', async () => {
    env = await setup(baseDir);
    // Pre-seed orphaned terminal + scrollback log on disk.
    const id = 'sess-1';
    await env.metaStore.write({
      id,
      projectSlug: 'demo',
      cwd: '/some/path',
      command: 'fake-shell',
      createdAt: '2026-01-01T00:00:00.000Z',
      lastActiveAt: '2026-01-02T03:04:05.000Z',
    });
    env.scrollback.append(id, 'older content\n');
    env.manager.loadOrphans();

    // Attach BEFORE respawn so we can observe the synthetic output chunks.
    await env.req('attach', { terminalId: id });
    // Pre-existing scrollback replay (`older content`) is delivered on attach.
    // Now run respawn.
    const res = await env.req('respawn', { terminalId: id });
    expect(res.payload.ok).toBe(true);

    // Verify fake spawn was called with the saved cwd and command.
    expect(env.spawn.created).toHaveLength(1);
    expect(env.spawn.created[0].opts.cwd).toBe('/some/path');
    expect(env.spawn.created[0].args).toEqual(['-lc', 'fake-shell']);

    // The respawn must produce the banner output event.
    const outputs = env.sent
      .filter((f) => f.type === 'event' && f.op === 'output' && f.terminalId === id)
      .map((f) => f.payload.data);
    const joined = outputs.join('');
    expect(joined).toContain('--- prior session ended at 2026-01-02T03:04:05.000Z ---');
    // Banner is ANSI-yellow.
    expect(joined).toContain('\x1b[33m');
    // The terminal is no longer marked needsRespawn.
    const meta = env.manager.inspect(id);
    expect(meta.needsRespawn).toBeFalsy();
    expect(meta.pid).toBeGreaterThan(0);
  });

  it('respawn appends to (not truncates) the existing scrollback log', async () => {
    env = await setup(baseDir);
    const id = 'sess-2';
    await env.metaStore.write({ id, projectSlug: 'p', cwd: '/tmp', command: 'foo' });
    env.scrollback.append(id, 'OLD-DATA');
    env.manager.loadOrphans();

    await env.req('respawn', { terminalId: id });
    // Live output from the freshly-spawned PTY should also land in scrollback.
    env.spawn.created[0].fake.__emit('NEW-DATA');
    const tail = env.scrollback.readTail(id);
    expect(tail).toContain('OLD-DATA');
    expect(tail).toContain('NEW-DATA');
  });

  it('respawn before any attach also succeeds; later attaches see the banner via replay', async () => {
    env = await setup(baseDir);
    const id = 'sess-3';
    await env.metaStore.write({
      id, projectSlug: 'p', cwd: '/tmp', command: 'foo',
      lastActiveAt: '2026-02-02T02:02:02.000Z',
    });
    env.scrollback.append(id, 'OLD\n');
    env.manager.loadOrphans();

    const r = await env.req('respawn', { terminalId: id });
    expect(r.payload.ok).toBe(true);

    // Now attach: replay should include the banner that was persisted at
    // respawn time.
    await env.req('attach', { terminalId: id });
    const outputs = env.sent
      .filter((f) => f.type === 'event' && f.op === 'output' && f.terminalId === id)
      .map((f) => f.payload.data)
      .join('');
    expect(outputs).toContain('--- prior session ended at 2026-02-02T02:02:02.000Z ---');
    expect(outputs).toContain('OLD');
  });

  it('respawn errors when the terminal has no orphan meta', async () => {
    env = await setup(baseDir);
    const r = await env.req('respawn', { terminalId: 'nonexistent' });
    expect(r.payload.ok).toBe(false);
    expect(r.payload.error).toMatch(/not found/);
  });

  it('respawn on an already-live terminal returns the existing terminal without re-spawning', async () => {
    env = await setup(baseDir);
    const live = env.manager.spawn({ projectSlug: 'p', cwd: '/tmp', command: 'foo' });
    const r = await env.req('respawn', { terminalId: live.id });
    expect(r.payload.ok).toBe(true);
    // Still only one spawn invocation.
    expect(env.spawn.created).toHaveLength(1);
  });
});

describe('lastActiveAt persistence', () => {
  let baseDir;
  let env;

  beforeEach(async () => { baseDir = await mkdtemp(join(tmpdir(), 'lastactive-')); });
  afterEach(async () => {
    env?.scrollback?.closeAll();
    if (env?.manager?.stopLastActiveFlusher) env.manager.stopLastActiveFlusher();
    if (baseDir) await rm(baseDir, { recursive: true, force: true });
  });

  it('lastActiveAt on meta.json is updated periodically (default 60s)', async () => {
    vi.useFakeTimers({ now: new Date('2026-05-16T00:00:00.000Z') });
    try {
      env = await setup(baseDir, { lastActiveFlushIntervalMs: 60_000 });
      const term = env.manager.spawn({ projectSlug: 'p', cwd: '/tmp', command: 'foo' });

      // Get the initial timestamp from disk.
      const first = env.metaStore.read(term.id).lastActiveAt;
      expect(first).toBe('2026-05-16T00:00:00.000Z');

      // Advance just under 60s, emit stream activity, but don't fire the
      // flusher yet.
      vi.setSystemTime(new Date('2026-05-16T00:00:30.000Z'));
      env.spawn.created[0].fake.__emit('tick');

      // Advance just under 60s from start: no flush yet.
      vi.advanceTimersByTime(50_000);
      expect(env.metaStore.read(term.id).lastActiveAt).toBe(first);

      // Advance past 60s — the flusher fires.
      vi.advanceTimersByTime(20_000);
      const after = env.metaStore.read(term.id).lastActiveAt;
      expect(after).not.toBe(first);
      // Should be within 65s of the activity at 30s mark (which == "first + 30s").
      expect(new Date(after).getTime()).toBeGreaterThanOrEqual(
        new Date(first).getTime() + 30_000
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
