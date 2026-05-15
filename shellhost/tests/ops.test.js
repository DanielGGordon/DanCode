import { describe, it, expect, beforeEach } from 'vitest';
import { PTYManager } from '../src/pty-manager.js';
import { handleFrame } from '../src/server.js';
import { makeRequest } from '../src/wire.js';

function makeFakeSpawn() {
  const created = [];
  const spawn = (file, args, opts) => {
    const dataListeners = new Set();
    const exitListeners = new Set();
    let cols = opts.cols, rows = opts.rows;
    const writes = [];
    const fake = {
      pid: 5000 + created.length,
      onData(cb) { dataListeners.add(cb); return { dispose() { dataListeners.delete(cb); } }; },
      onExit(cb) { exitListeners.add(cb); return { dispose() { exitListeners.delete(cb); } }; },
      write(d) { writes.push(d); },
      resize(c, r) { cols = c; rows = r; },
      kill() { for (const f of exitListeners) f({ exitCode: 0, signal: null }); },
      get __writes() { return writes; },
      get __cols() { return cols; },
      get __rows() { return rows; },
      __emit(d) { for (const f of dataListeners) f(d); },
      __exit(c) { for (const f of exitListeners) f({ exitCode: c, signal: null }); },
    };
    created.push({ file, args, opts, fake });
    return fake;
  };
  spawn.created = created;
  return spawn;
}

function setup() {
  const spawn = makeFakeSpawn();
  const manager = new PTYManager({ spawn });
  const attachments = new Map();
  const sent = [];
  const ctx = {
    send: (f) => sent.push(f),
    attachments,
    ptyManager: manager,
  };
  let nextRid = 1;
  const req = async (op, payload) => {
    const rid = `r${nextRid++}`;
    await handleFrame(makeRequest(rid, op, payload), ctx);
    const response = sent.find((s) => s.type === 'res' && s.requestId === rid);
    return response;
  };
  return { spawn, manager, attachments, sent, ctx, req };
}

describe('wire op dispatch', () => {
  let env;
  beforeEach(() => { env = setup(); });

  it('spawn returns a terminalId in the result', async () => {
    const res = await env.req('spawn', { projectSlug: 'demo', cwd: '/tmp', command: 'true' });
    expect(res.payload.ok).toBe(true);
    expect(res.payload.result.terminalId).toMatch(/^[a-f0-9-]{36}$/);
    expect(res.payload.result.terminal.projectSlug).toBe('demo');
  });

  it('spawn returns an error when projectSlug missing', async () => {
    const res = await env.req('spawn', {});
    expect(res.payload.ok).toBe(false);
    expect(res.payload.error).toMatch(/projectSlug/);
  });

  it('attach succeeds for live terminal and starts emitting output events', async () => {
    const spawnRes = await env.req('spawn', { projectSlug: 'p' });
    const tid = spawnRes.payload.result.terminalId;

    const attachRes = await env.req('attach', { terminalId: tid });
    expect(attachRes.payload.ok).toBe(true);

    env.spawn.created[0].fake.__emit('hello');
    const outputEvents = env.sent.filter((f) => f.type === 'event' && f.op === 'output');
    expect(outputEvents).toHaveLength(1);
    expect(outputEvents[0].terminalId).toBe(tid);
    expect(outputEvents[0].payload.data).toBe('hello');
  });

  it('attach on an unknown terminal returns error', async () => {
    const res = await env.req('attach', { terminalId: 'no-such' });
    expect(res.payload.ok).toBe(false);
    expect(res.payload.error).toMatch(/not found/);
  });

  it('attach is idempotent on the same connection', async () => {
    const sp = await env.req('spawn', { projectSlug: 'p' });
    const tid = sp.payload.result.terminalId;
    const a1 = await env.req('attach', { terminalId: tid });
    const a2 = await env.req('attach', { terminalId: tid });
    expect(a1.payload.ok).toBe(true);
    expect(a2.payload.ok).toBe(true);
    // Only one listener registered, so a single emit yields a single event.
    env.spawn.created[0].fake.__emit('once');
    const outputs = env.sent.filter((f) => f.type === 'event' && f.op === 'output');
    expect(outputs).toHaveLength(1);
  });

  it('detach stops further output events but keeps PTY alive', async () => {
    const sp = await env.req('spawn', { projectSlug: 'p' });
    const tid = sp.payload.result.terminalId;
    await env.req('attach', { terminalId: tid });
    env.spawn.created[0].fake.__emit('first');
    await env.req('detach', { terminalId: tid });
    env.spawn.created[0].fake.__emit('second');
    const outputs = env.sent.filter((f) => f.type === 'event' && f.op === 'output');
    expect(outputs.map((o) => o.payload.data)).toEqual(['first']);
    // The terminal is still inspectable (not killed).
    const inspectRes = await env.req('inspect', { terminalId: tid });
    expect(inspectRes.payload.ok).toBe(true);
  });

  it('write forwards data to the PTY', async () => {
    const sp = await env.req('spawn', { projectSlug: 'p' });
    const tid = sp.payload.result.terminalId;
    await env.req('write', { terminalId: tid, data: 'ls\r' });
    expect(env.spawn.created[0].fake.__writes).toEqual(['ls\r']);
  });

  it('write rejects non-string data', async () => {
    const sp = await env.req('spawn', { projectSlug: 'p' });
    const tid = sp.payload.result.terminalId;
    const res = await env.req('write', { terminalId: tid, data: 123 });
    expect(res.payload.ok).toBe(false);
    expect(res.payload.error).toMatch(/string/);
  });

  it('resize forwards dimensions', async () => {
    const sp = await env.req('spawn', { projectSlug: 'p' });
    const tid = sp.payload.result.terminalId;
    const res = await env.req('resize', { terminalId: tid, cols: 120, rows: 40 });
    expect(res.payload.ok).toBe(true);
    expect(env.spawn.created[0].fake.__cols).toBe(120);
    expect(env.spawn.created[0].fake.__rows).toBe(40);
  });

  it('kill removes the terminal and detaches listeners', async () => {
    const sp = await env.req('spawn', { projectSlug: 'p' });
    const tid = sp.payload.result.terminalId;
    await env.req('attach', { terminalId: tid });
    const res = await env.req('kill', { terminalId: tid });
    expect(res.payload.ok).toBe(true);
    expect(env.manager.inspect(tid)).toBeNull();
    expect(env.attachments.has(tid)).toBe(false);
  });

  it('list returns the terminals filtered by projectSlug', async () => {
    const a = (await env.req('spawn', { projectSlug: 'alpha' })).payload.result.terminalId;
    const b = (await env.req('spawn', { projectSlug: 'beta' })).payload.result.terminalId;
    const c = (await env.req('spawn', { projectSlug: 'alpha' })).payload.result.terminalId;
    const all = await env.req('list', {});
    expect(all.payload.result.terminals.map((t) => t.id).sort()).toEqual([a, b, c].sort());
    const alphas = await env.req('list', { projectSlug: 'alpha' });
    expect(alphas.payload.result.terminals.map((t) => t.id).sort()).toEqual([a, c].sort());
  });

  it('inspect returns metadata for a live terminal', async () => {
    const sp = await env.req('spawn', { projectSlug: 'p', cwd: '/tmp', command: 'sleep 1' });
    const tid = sp.payload.result.terminalId;
    const ins = await env.req('inspect', { terminalId: tid });
    expect(ins.payload.ok).toBe(true);
    expect(ins.payload.result.terminal.cwd).toBe('/tmp');
    expect(ins.payload.result.terminal.command).toBe('sleep 1');
  });

  it('inspect errors for unknown id', async () => {
    const ins = await env.req('inspect', { terminalId: 'unknown' });
    expect(ins.payload.ok).toBe(false);
  });

  it('rejects unknown op', async () => {
    const res = await env.req('frobnicate', {});
    expect(res.payload.ok).toBe(false);
    expect(res.payload.error).toMatch(/unknown op/);
  });

  it('PTY exit emits an exit event to attached connections', async () => {
    const sp = await env.req('spawn', { projectSlug: 'p' });
    const tid = sp.payload.result.terminalId;
    await env.req('attach', { terminalId: tid });
    env.spawn.created[0].fake.__exit(7);
    const exitEvents = env.sent.filter((f) => f.type === 'event' && f.op === 'exit');
    expect(exitEvents).toHaveLength(1);
    expect(exitEvents[0].terminalId).toBe(tid);
    expect(exitEvents[0].payload.exitCode).toBe(7);
  });
});
