import { describe, it, expect, beforeEach } from 'vitest';
import { PTYManager } from '../src/pty-manager.js';

/**
 * Fake PTY factory so these tests don't require node-pty's bindings,
 * and stay deterministic / fast.
 */
function makeFakeSpawn() {
  const created = [];
  const spawn = (file, args, opts) => {
    const dataListeners = new Set();
    const exitListeners = new Set();
    let killed = false;
    let cols = opts.cols;
    let rows = opts.rows;
    let writes = [];

    const fake = {
      pid: 9000 + created.length,
      get __dataListeners() { return dataListeners; },
      get __exitListeners() { return exitListeners; },
      get __cols() { return cols; },
      get __rows() { return rows; },
      get __killed() { return killed; },
      get __writes() { return writes; },
      onData(cb) { dataListeners.add(cb); return { dispose() { dataListeners.delete(cb); } }; },
      onExit(cb) { exitListeners.add(cb); return { dispose() { exitListeners.delete(cb); } }; },
      write(d) { writes.push(d); },
      resize(c, r) { cols = c; rows = r; },
      kill(sig) {
        killed = true;
        // Synchronously fire the exit listeners.
        for (const fn of exitListeners) fn({ exitCode: 0, signal: sig ?? null });
      },
      // Test hooks
      __emit(data) { for (const fn of dataListeners) fn(data); },
      __exit(exitCode, signal = null) {
        for (const fn of exitListeners) fn({ exitCode, signal });
      },
    };
    created.push({ file, args, opts, fake });
    return fake;
  };
  spawn.created = created;
  return spawn;
}

describe('PTYManager', () => {
  let spawn;
  let mgr;
  beforeEach(() => {
    spawn = makeFakeSpawn();
    mgr = new PTYManager({ spawn });
  });

  it('spawn returns a terminal with a fresh id and required metadata', () => {
    const meta = mgr.spawn({ projectSlug: 'demo', cwd: '/tmp', command: 'echo hi' });
    expect(meta.id).toMatch(/^[a-f0-9-]{36}$/);
    expect(meta.projectSlug).toBe('demo');
    expect(meta.cwd).toBe('/tmp');
    expect(meta.command).toBe('echo hi');
    expect(meta.cols).toBe(80);
    expect(meta.rows).toBe(24);
    expect(meta.pid).toBeGreaterThan(0);
    expect(meta.exited).toBe(false);
  });

  it('spawn passes TERM=xterm-256color', () => {
    mgr.spawn({ projectSlug: 'demo' });
    const created = spawn.created[0];
    expect(created.opts.env.TERM).toBe('xterm-256color');
    expect(created.opts.name).toBe('xterm-256color');
  });

  it('spawn requires projectSlug', () => {
    expect(() => mgr.spawn({})).toThrow(/projectSlug/);
  });

  it('attach forwards output to onOutput callback', () => {
    const { id } = mgr.spawn({ projectSlug: 'p' });
    const seen = [];
    mgr.attach(id, { onOutput: (d) => seen.push(d) });
    const fake = spawn.created[0].fake;
    fake.__emit('hello\n');
    fake.__emit('world\n');
    expect(seen).toEqual(['hello\n', 'world\n']);
  });

  it('detach stops the listener from receiving further output', () => {
    const { id } = mgr.spawn({ projectSlug: 'p' });
    const seen = [];
    const onOutput = (d) => seen.push(d);
    const detach = mgr.attach(id, { onOutput });
    const fake = spawn.created[0].fake;
    fake.__emit('one');
    detach();
    fake.__emit('two');
    expect(seen).toEqual(['one']);
  });

  it('detach does NOT kill the PTY', () => {
    const { id } = mgr.spawn({ projectSlug: 'p' });
    const detach = mgr.attach(id, { onOutput: () => {} });
    detach();
    const fake = spawn.created[0].fake;
    expect(fake.__killed).toBe(false);
    expect(mgr.inspect(id)).not.toBeNull();
  });

  it('multiple attaches each get their own output stream', () => {
    const { id } = mgr.spawn({ projectSlug: 'p' });
    const a = [];
    const b = [];
    mgr.attach(id, { onOutput: (d) => a.push(d) });
    mgr.attach(id, { onOutput: (d) => b.push(d) });
    spawn.created[0].fake.__emit('shared');
    expect(a).toEqual(['shared']);
    expect(b).toEqual(['shared']);
  });

  it('write forwards bytes to the PTY', () => {
    const { id } = mgr.spawn({ projectSlug: 'p' });
    mgr.write(id, 'ls -la\n');
    expect(spawn.created[0].fake.__writes).toEqual(['ls -la\n']);
  });

  it('write returns false for unknown terminal', () => {
    expect(mgr.write('no-such-id', 'hi')).toBe(false);
  });

  it('resize forwards new dimensions to the PTY', () => {
    const { id } = mgr.spawn({ projectSlug: 'p' });
    expect(mgr.resize(id, 132, 48)).toBe(true);
    expect(spawn.created[0].fake.__cols).toBe(132);
    expect(spawn.created[0].fake.__rows).toBe(48);
  });

  it('resize rejects invalid dimensions', () => {
    const { id } = mgr.spawn({ projectSlug: 'p' });
    expect(mgr.resize(id, 0, 24)).toBe(false);
    expect(mgr.resize(id, 80, -1)).toBe(false);
    expect(mgr.resize(id, 80.5, 24)).toBe(false);
  });

  it('kill marks the terminal gone and fires exit listeners', () => {
    const { id } = mgr.spawn({ projectSlug: 'p' });
    const exits = [];
    mgr.attach(id, { onExit: (e) => exits.push(e) });
    expect(mgr.kill(id)).toBe(true);
    expect(spawn.created[0].fake.__killed).toBe(true);
    expect(exits).toHaveLength(1);
    expect(exits[0].exitCode).toBe(0);
    expect(mgr.inspect(id)).toBeNull();
  });

  it('list filters by projectSlug', () => {
    const a = mgr.spawn({ projectSlug: 'alpha' });
    const b = mgr.spawn({ projectSlug: 'beta' });
    const c = mgr.spawn({ projectSlug: 'alpha' });
    const alphas = mgr.list({ projectSlug: 'alpha' });
    expect(alphas.map((t) => t.id).sort()).toEqual([a.id, c.id].sort());
    expect(mgr.list({ projectSlug: 'gamma' })).toEqual([]);
    expect(mgr.list().map((t) => t.id).sort()).toEqual([a.id, b.id, c.id].sort());
  });

  it('inspect returns null for unknown id', () => {
    expect(mgr.inspect('nope')).toBeNull();
  });

  it('PTY exit fires exit listeners and marks terminal exited', () => {
    const { id } = mgr.spawn({ projectSlug: 'p' });
    const exits = [];
    mgr.attach(id, { onExit: (e) => exits.push(e) });
    spawn.created[0].fake.__exit(42);
    expect(exits).toEqual([{ exitCode: 42, signal: null }]);
    const meta = mgr.inspect(id);
    expect(meta.exited).toBe(true);
    expect(meta.exitCode).toBe(42);
  });

  it('attach on an already-exited PTY immediately fires onExit', () => {
    const { id } = mgr.spawn({ projectSlug: 'p' });
    spawn.created[0].fake.__exit(0);
    const exits = [];
    mgr.attach(id, { onExit: (e) => exits.push(e) });
    expect(exits).toEqual([{ exitCode: 0, signal: null }]);
  });

  it('killAll terminates every terminal', () => {
    mgr.spawn({ projectSlug: 'a' });
    mgr.spawn({ projectSlug: 'b' });
    mgr.spawn({ projectSlug: 'c' });
    mgr.killAll();
    expect(mgr.list()).toEqual([]);
  });

  it('builds command-mode invocation through the user shell', () => {
    mgr.spawn({ projectSlug: 'demo', command: 'echo hi' });
    const created = spawn.created[0];
    expect(created.args).toEqual(['-lc', 'echo hi']);
  });

  it('builds login-shell invocation when no command given', () => {
    mgr.spawn({ projectSlug: 'demo' });
    const created = spawn.created[0];
    expect(created.args).toEqual(['-l']);
  });
});
