import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PTYManager } from '../src/pty-manager.js';
import { ScrollbackStore } from '../src/scrollback.js';
import { MetaStore } from '../src/meta-store.js';
import { handleFrame } from '../src/server.js';
import { makeRequest } from '../src/wire.js';

/**
 * Fake PTY factory shared with other shellhost tests. Records the invocation
 * arguments so we can assert command-line shape (esp. systemd-run wrapping).
 */
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

async function setup(baseDir, opts = {}) {
  const spawn = makeFakeSpawn();
  const scrollback = new ScrollbackStore({ baseDir, maxBytes: 1_000_000, tailBytes: 50 * 1024 });
  const metaStore = new MetaStore({ baseDir });
  const systemctlCalls = [];
  const runSystemctl = opts.runSystemctl ?? ((args) => {
    systemctlCalls.push(args);
    return { ok: true };
  });
  const manager = new PTYManager({
    spawn,
    scrollback,
    metaStore,
    runSystemctl,
    ...opts,
  });
  const attachments = new Map();
  const sent = [];
  const ctx = { send: (f) => sent.push(f), attachments, ptyManager: manager };
  let nextRid = 1;
  const req = async (op, payload) => {
    const rid = `r${nextRid++}`;
    await handleFrame(makeRequest(rid, op, payload), ctx);
    return sent.find((s) => s.type === 'res' && s.requestId === rid);
  };
  return { spawn, scrollback, metaStore, manager, systemctlCalls, req, sent };
}

describe('Background mode: PTYManager.spawn', () => {
  let baseDir;
  let env;

  beforeEach(async () => { baseDir = await mkdtemp(join(tmpdir(), 'bgmode-')); });
  afterEach(async () => {
    env?.scrollback?.closeAll();
    env?.manager?.stopLastActiveFlusher?.();
    if (baseDir) await rm(baseDir, { recursive: true, force: true });
  });

  it('spawn({ background: true }) persists background=true on meta and public metadata', async () => {
    env = await setup(baseDir);
    const meta = env.manager.spawn({
      projectSlug: 'p',
      cwd: '/tmp',
      command: 'sleep 30',
      background: true,
    });
    expect(meta.background).toBe(true);
    const onDisk = JSON.parse(await readFile(join(baseDir, meta.id, 'meta.json'), 'utf8'));
    expect(onDisk.background).toBe(true);
  });

  it('spawn without background flag defaults to background=false on meta', async () => {
    env = await setup(baseDir);
    const meta = env.manager.spawn({ projectSlug: 'p', cwd: '/tmp', command: 'sleep 5' });
    expect(meta.background).toBe(false);
    const onDisk = JSON.parse(await readFile(join(baseDir, meta.id, 'meta.json'), 'utf8'));
    expect(onDisk.background).toBe(false);
  });

  it('loadOrphans preserves background flag from meta into needs-respawn entries', async () => {
    env = await setup(baseDir);
    await env.metaStore.write({
      id: 'orphan-bg',
      projectSlug: 'p',
      cwd: '/tmp',
      command: 'sleep 30',
      background: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      lastActiveAt: '2026-01-01T00:01:00.000Z',
    });
    env.manager.loadOrphans();
    const entry = env.manager.inspect('orphan-bg');
    expect(entry.background).toBe(true);
  });
});

describe('Background mode: systemd-run command wrapping', () => {
  let baseDir;
  let env;

  beforeEach(async () => { baseDir = await mkdtemp(join(tmpdir(), 'bgmode-')); });
  afterEach(async () => {
    env?.scrollback?.closeAll();
    env?.manager?.stopLastActiveFlusher?.();
    if (baseDir) await rm(baseDir, { recursive: true, force: true });
  });

  it('background spawn wraps the command via systemd-run --user --scope --unit=dancode-bg-<id>', async () => {
    env = await setup(baseDir);
    const meta = env.manager.spawn({
      projectSlug: 'p',
      cwd: '/tmp',
      command: 'sleep 30',
      background: true,
    });
    expect(env.spawn.created).toHaveLength(1);
    const { file, args } = env.spawn.created[0];
    expect(file).toBe('systemd-run');
    expect(args.slice(0, 4)).toEqual([
      '--user',
      '--scope',
      '--quiet',
      `--unit=dancode-bg-${meta.id}`,
    ]);
    // The wrapper must place the user command in its own session (via
    // `setsid --wait`) so the kernel does not deliver SIGHUP from a closed
    // controlling terminal when shellhost dies.
    expect(args).toContain('setsid');
    expect(args).toContain('--wait');
    expect(args).toContain('-lc');
    // The shell command also adds an explicit `trap '' HUP` belt-and-braces.
    expect(args[args.length - 1]).toMatch(/trap '' HUP;.*sleep 30/);
  });

  it('non-background spawn does NOT use systemd-run', async () => {
    env = await setup(baseDir);
    env.manager.spawn({ projectSlug: 'p', cwd: '/tmp', command: 'sleep 5' });
    const { file } = env.spawn.created[0];
    expect(file).not.toBe('systemd-run');
  });

  it('background spawn without command still wraps via systemd-run (login shell)', async () => {
    env = await setup(baseDir);
    const meta = env.manager.spawn({ projectSlug: 'p', cwd: '/tmp', background: true });
    const { file, args } = env.spawn.created[0];
    expect(file).toBe('systemd-run');
    expect(args).toContain(`--unit=dancode-bg-${meta.id}`);
    // Interactive login shell uses `-il` so the prompt still shows when
    // foregrounded. (Plain `-l` would exit if stdin is non-interactive.)
    expect(args.some((a) => a === '-il' || a === '-i')).toBe(true);
  });
});

describe('Background mode: setBackground wire op', () => {
  let baseDir;
  let env;

  beforeEach(async () => { baseDir = await mkdtemp(join(tmpdir(), 'bgmode-')); });
  afterEach(async () => {
    env?.scrollback?.closeAll();
    env?.manager?.stopLastActiveFlusher?.();
    if (baseDir) await rm(baseDir, { recursive: true, force: true });
  });

  it('setBackground op toggles the flag on meta but does NOT restart the PTY', async () => {
    env = await setup(baseDir);
    const meta = env.manager.spawn({ projectSlug: 'p', cwd: '/tmp', command: 'sleep 5' });
    expect(env.spawn.created).toHaveLength(1);

    const res = await env.req('setBackground', { terminalId: meta.id, background: true });
    expect(res.payload.ok).toBe(true);
    expect(res.payload.result.terminal.background).toBe(true);

    // PTY was not restarted: still only one spawn invocation.
    expect(env.spawn.created).toHaveLength(1);

    // Meta on disk reflects the new background value.
    const onDisk = JSON.parse(await readFile(join(baseDir, meta.id, 'meta.json'), 'utf8'));
    expect(onDisk.background).toBe(true);

    // After respawn, the new PTY uses the systemd-run wrapper.
    env.manager.kill(meta.id);
  });

  it('setBackground op accepts background=false to disable', async () => {
    env = await setup(baseDir);
    const meta = env.manager.spawn({
      projectSlug: 'p', cwd: '/tmp', command: 'sleep 5', background: true,
    });
    const res = await env.req('setBackground', { terminalId: meta.id, background: false });
    expect(res.payload.ok).toBe(true);
    expect(res.payload.result.terminal.background).toBe(false);
    const onDisk = JSON.parse(await readFile(join(baseDir, meta.id, 'meta.json'), 'utf8'));
    expect(onDisk.background).toBe(false);
  });

  it('setBackground op errors when the terminal does not exist', async () => {
    env = await setup(baseDir);
    const res = await env.req('setBackground', { terminalId: 'nope', background: true });
    expect(res.payload.ok).toBe(false);
    expect(res.payload.error).toMatch(/not found/);
  });
});

describe('Background mode: kill propagates to systemd scope', () => {
  let baseDir;
  let env;

  beforeEach(async () => { baseDir = await mkdtemp(join(tmpdir(), 'bgmode-')); });
  afterEach(async () => {
    env?.scrollback?.closeAll();
    env?.manager?.stopLastActiveFlusher?.();
    if (baseDir) await rm(baseDir, { recursive: true, force: true });
  });

  it('kill on a background terminal invokes systemctl --user stop dancode-bg-<id>.scope', async () => {
    env = await setup(baseDir);
    const meta = env.manager.spawn({
      projectSlug: 'p',
      cwd: '/tmp',
      command: 'sleep 30',
      background: true,
    });
    const ok = env.manager.kill(meta.id);
    expect(ok).toBe(true);
    expect(env.systemctlCalls).toHaveLength(1);
    expect(env.systemctlCalls[0]).toEqual(['--user', 'stop', `dancode-bg-${meta.id}.scope`]);
  });

  it('kill on a non-background terminal does NOT invoke systemctl', async () => {
    env = await setup(baseDir);
    const meta = env.manager.spawn({ projectSlug: 'p', cwd: '/tmp', command: 'sleep 5' });
    env.manager.kill(meta.id);
    expect(env.systemctlCalls).toHaveLength(0);
  });

  it('kill on a needs-respawn background terminal still invokes systemctl stop', async () => {
    env = await setup(baseDir);
    await env.metaStore.write({
      id: 'orphan-bg-kill',
      projectSlug: 'p',
      cwd: '/tmp',
      command: 'sleep 30',
      background: true,
    });
    env.manager.loadOrphans();
    env.manager.kill('orphan-bg-kill');
    expect(env.systemctlCalls).toHaveLength(1);
    expect(env.systemctlCalls[0]).toEqual(['--user', 'stop', 'dancode-bg-orphan-bg-kill.scope']);
  });
});
