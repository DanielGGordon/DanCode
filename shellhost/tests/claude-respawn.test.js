import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PTYManager } from '../src/pty-manager.js';
import { ScrollbackStore } from '../src/scrollback.js';
import { MetaStore } from '../src/meta-store.js';
import { buildClaudeResumeCommand, isClaudeCommand } from '../src/claude-detector.js';

function makeFakeSpawn() {
  const created = [];
  const spawn = (file, args, opts) => {
    const dataListeners = new Set();
    const exitListeners = new Set();
    const fake = {
      pid: 7000 + created.length,
      ptsName: `/dev/pts/${100 + created.length}`,
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

describe('isClaudeCommand', () => {
  it('detects bare `claude`', () => {
    expect(isClaudeCommand('claude')).toBe(true);
  });
  it('detects `claude --foo`', () => {
    expect(isClaudeCommand('claude --print "hello"')).toBe(true);
  });
  it('detects existing resume command', () => {
    expect(isClaudeCommand('claude --resume abc-123')).toBe(true);
  });
  it('rejects unrelated commands', () => {
    expect(isClaudeCommand('bash -l')).toBe(false);
    expect(isClaudeCommand(null)).toBe(false);
    expect(isClaudeCommand('')).toBe(false);
    expect(isClaudeCommand('echo claude')).toBe(false);
  });
});

describe('buildClaudeResumeCommand', () => {
  it('returns `claude --resume <id>` regardless of the original command shape', () => {
    expect(buildClaudeResumeCommand('claude', 'sess-1')).toBe('claude --resume sess-1');
    expect(buildClaudeResumeCommand('claude --foo bar', 'sess-2')).toBe('claude --resume sess-2');
    expect(buildClaudeResumeCommand('claude --resume old-id', 'new-id')).toBe('claude --resume new-id');
  });

  it('rejects non-Claude commands (caller should not invoke this)', () => {
    expect(() => buildClaudeResumeCommand('bash -l', 'sid')).toThrow();
  });

  it('rejects empty session ids', () => {
    expect(() => buildClaudeResumeCommand('claude', '')).toThrow();
    expect(() => buildClaudeResumeCommand('claude', null)).toThrow();
  });

  it('escapes a session id that contains shell metacharacters (defensive)', () => {
    // Session ids in practice are UUIDs, but defend against $/`/space etc.
    const out = buildClaudeResumeCommand('claude', 'a b$c');
    // The session id must be passed as a single argument; we wrap it in
    // single quotes when it contains anything outside [A-Za-z0-9._-].
    expect(out).toBe("claude --resume 'a b$c'");
  });
});

describe('PTYManager + Claude respawn', () => {
  let baseDir;
  let env;

  beforeEach(async () => { baseDir = await mkdtemp(join(tmpdir(), 'claude-respawn-')); });
  afterEach(async () => {
    env?.scrollback?.closeAll?.();
    if (baseDir) await rm(baseDir, { recursive: true, force: true });
  });

  async function setup() {
    const spawn = makeFakeSpawn();
    const scrollback = new ScrollbackStore({ baseDir });
    const metaStore = new MetaStore({ baseDir });
    const manager = new PTYManager({ spawn, scrollback, metaStore });
    return { spawn, scrollback, metaStore, manager };
  }

  it('getTty returns the live PTY ptsName, or null for needs-respawn', async () => {
    env = await setup();
    const m = env.manager.spawn({ projectSlug: 'p', cwd: '/tmp' });
    const tty = env.manager.getTty(m.id);
    expect(tty).toMatch(/^\/dev\/pts\/\d+$/);

    // Orphan path: a needs-respawn entry has no PTY → null.
    await env.metaStore.write({ id: 'orphan', projectSlug: 'p', cwd: '/tmp' });
    env.manager.loadOrphans();
    expect(env.manager.getTty('orphan')).toBeNull();
  });

  it('setClaudeSessionId updates the in-memory record and is read back by inspect', async () => {
    env = await setup();
    const m = env.manager.spawn({ projectSlug: 'p', cwd: '/tmp' });
    env.manager.setClaudeSessionId(m.id, 'session-xyz');
    expect(env.manager.inspect(m.id).claudeSessionId).toBe('session-xyz');
  });

  it('respawn uses `claude --resume <id>` when meta has a claudeSessionId AND a Claude command', async () => {
    env = await setup();
    const id = 'sess-orphan';
    await env.metaStore.write({
      id,
      projectSlug: 'p',
      cwd: '/tmp',
      command: 'claude',
      claudeSessionId: 'sid-99',
      lastActiveAt: '2026-05-17T00:00:00.000Z',
    });
    env.manager.loadOrphans();
    env.manager.respawn(id);
    // Fake spawn was called with the resume command.
    expect(env.spawn.created).toHaveLength(1);
    expect(env.spawn.created[0].args).toEqual(['-lc', 'claude --resume sid-99']);
  });

  it('respawn does NOT rewrite the command when meta lacks a claudeSessionId', async () => {
    env = await setup();
    const id = 'sess-orphan-2';
    await env.metaStore.write({
      id,
      projectSlug: 'p',
      cwd: '/tmp',
      command: 'claude',
    });
    env.manager.loadOrphans();
    env.manager.respawn(id);
    expect(env.spawn.created[0].args).toEqual(['-lc', 'claude']);
  });

  it('respawn does NOT rewrite the command when meta.command is NOT a Claude invocation', async () => {
    env = await setup();
    const id = 'sess-orphan-3';
    await env.metaStore.write({
      id,
      projectSlug: 'p',
      cwd: '/tmp',
      command: 'bash -l',
      claudeSessionId: 'sid-99',
    });
    env.manager.loadOrphans();
    env.manager.respawn(id);
    expect(env.spawn.created[0].args).toEqual(['-lc', 'bash -l']);
  });

  it('publicMeta exposes claudeSessionId for live and needs-respawn terminals', async () => {
    env = await setup();
    const m = env.manager.spawn({ projectSlug: 'p' });
    env.manager.setClaudeSessionId(m.id, 'sid-abc');
    expect(env.manager.inspect(m.id).claudeSessionId).toBe('sid-abc');

    // For needs-respawn, loadOrphans should populate from meta.
    await env.metaStore.write({
      id: 'orphan-with-sid', projectSlug: 'p', cwd: '/tmp',
      claudeSessionId: 'sid-xyz',
    });
    env.manager.loadOrphans();
    expect(env.manager.inspect('orphan-with-sid').claudeSessionId).toBe('sid-xyz');
  });
});
