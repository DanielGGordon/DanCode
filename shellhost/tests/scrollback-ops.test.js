import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PTYManager } from '../src/pty-manager.js';
import { ScrollbackStore } from '../src/scrollback.js';
import { handleFrame } from '../src/server.js';
import { makeRequest } from '../src/wire.js';

function makeFakeSpawn() {
  const created = [];
  const spawn = (file, args, opts) => {
    const dataListeners = new Set();
    const exitListeners = new Set();
    const fake = {
      pid: 7000 + created.length,
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

async function setup(baseDir) {
  const spawn = makeFakeSpawn();
  const scrollback = new ScrollbackStore({ baseDir, maxBytes: 64, tailBytes: 50 });
  const manager = new PTYManager({ spawn, scrollback });
  const attachments = new Map();
  const sent = [];
  const ctx = { send: (f) => sent.push(f), attachments, ptyManager: manager };
  let nextRid = 1;
  const req = async (op, payload) => {
    const rid = `r${nextRid++}`;
    await handleFrame(makeRequest(rid, op, payload), ctx);
    return sent.find((s) => s.type === 'res' && s.requestId === rid);
  };
  return { spawn, scrollback, manager, attachments, sent, ctx, req };
}

describe('shellhost scrollback integration', () => {
  let baseDir;
  let env;

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'sb-ops-'));
    env = await setup(baseDir);
  });

  afterEach(async () => {
    env?.scrollback?.closeAll();
    if (baseDir) await rm(baseDir, { recursive: true, force: true });
  });

  it('PTY output is appended to scrollback on disk', async () => {
    const sp = await env.req('spawn', { projectSlug: 'p' });
    const tid = sp.payload.result.terminalId;
    env.spawn.created[0].fake.__emit('hello ');
    env.spawn.created[0].fake.__emit('world\n');
    expect(env.scrollback.readTail(tid)).toBe('hello world\n');
  });

  it('attach replays the scrollback tail to the new attacher before live output', async () => {
    const sp = await env.req('spawn', { projectSlug: 'p' });
    const tid = sp.payload.result.terminalId;
    // Emit some output BEFORE any attach exists.
    env.spawn.created[0].fake.__emit('past output');
    // Now attach: the replay should arrive as an output event.
    await env.req('attach', { terminalId: tid });
    const outputs = env.sent
      .filter((f) => f.type === 'event' && f.op === 'output' && f.terminalId === tid)
      .map((f) => f.payload.data);
    expect(outputs).toContain('past output');
  });

  it('multiple attaches each receive the replay', async () => {
    // We model multiple attaches as two separate "connection" contexts (each
    // with its own attachments map + send), pointed at the same manager.
    const sp = await env.req('spawn', { projectSlug: 'p' });
    const tid = sp.payload.result.terminalId;
    env.spawn.created[0].fake.__emit('shared replay');

    // Second "connection"
    const sentB = [];
    const ctxB = {
      send: (f) => sentB.push(f),
      attachments: new Map(),
      ptyManager: env.manager,
    };
    await handleFrame(makeRequest('rB', 'attach', { terminalId: tid }), ctxB);

    const outA = env.sent
      .filter((f) => f.type === 'event' && f.op === 'output' && f.terminalId === tid)
      .map((f) => f.payload.data);
    // First connection attaches via env.req:
    await env.req('attach', { terminalId: tid });
    const outA2 = env.sent
      .filter((f) => f.type === 'event' && f.op === 'output' && f.terminalId === tid)
      .map((f) => f.payload.data);

    const outB = sentB
      .filter((f) => f.type === 'event' && f.op === 'output' && f.terminalId === tid)
      .map((f) => f.payload.data);

    expect(outB).toContain('shared replay');
    expect(outA2).toContain('shared replay');
  });

  it('attach to a terminal with no prior output sends no replay events', async () => {
    const sp = await env.req('spawn', { projectSlug: 'p' });
    const tid = sp.payload.result.terminalId;
    await env.req('attach', { terminalId: tid });
    const outputs = env.sent.filter((f) => f.type === 'event' && f.op === 'output');
    expect(outputs).toEqual([]);
  });

  it('attach mid-rotation replays tail from both the rotated and current file', async () => {
    const sp = await env.req('spawn', { projectSlug: 'p' });
    const tid = sp.payload.result.terminalId;
    // tailBytes=50, maxBytes=64. Emit enough to rotate and then more.
    env.spawn.created[0].fake.__emit('A'.repeat(40));
    env.spawn.created[0].fake.__emit('B'.repeat(30)); // triggers rotation at 70 > 64
    env.spawn.created[0].fake.__emit('C'.repeat(20));
    // current file = 'C'*20 (20 bytes); rotation file = 'A'*40 + 'B'*30 (70 bytes).
    // tail with 50 bytes = last 50 of (rotated + current) = last 30 of rotated + all 20 current
    //   = 'B'*30 + 'C'*20.
    await env.req('attach', { terminalId: tid });
    const outputs = env.sent
      .filter((f) => f.type === 'event' && f.op === 'output' && f.terminalId === tid)
      .map((f) => f.payload.data)
      .join('');
    expect(outputs).toBe('B'.repeat(30) + 'C'.repeat(20));
  });

  it('kill removes the on-disk scrollback for the terminal', async () => {
    const sp = await env.req('spawn', { projectSlug: 'p' });
    const tid = sp.payload.result.terminalId;
    env.spawn.created[0].fake.__emit('bye');
    expect(env.scrollback.readTail(tid)).toBe('bye');
    await env.req('kill', { terminalId: tid });
    expect(env.scrollback.readTail(tid)).toBe('');
  });

  it('getScrollback op returns the tail without touching live listeners', async () => {
    const sp = await env.req('spawn', { projectSlug: 'p' });
    const tid = sp.payload.result.terminalId;
    env.spawn.created[0].fake.__emit('history');
    const res = await env.req('getScrollback', { terminalId: tid });
    expect(res.payload.ok).toBe(true);
    expect(res.payload.result.data).toBe('history');
    // No output events were sent because we didn't attach.
    const outputs = env.sent.filter((f) => f.type === 'event' && f.op === 'output');
    expect(outputs).toEqual([]);
  });
});
