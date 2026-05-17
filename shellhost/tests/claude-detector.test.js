import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parsePsForegroundOutput,
  isClaudeProcess,
  findNewestClaudeSession,
  ClaudeDetector,
} from '../src/claude-detector.js';

describe('parsePsForegroundOutput', () => {
  it('returns the foreground process command from `ps -o stat=,command= -t <tty>` output', () => {
    // Mimic real ps output: one row per process on the tty, the foreground
    // process has '+' in its STAT field.
    const ps = [
      'Ss   -bash',
      'S+   claude',
    ].join('\n');
    expect(parsePsForegroundOutput(ps)).toEqual({ stat: 'S+', command: 'claude' });
  });

  it('returns null when no row has a + in its STAT field', () => {
    const ps = [
      'Ss   -bash',
      'S    sleep 1',
    ].join('\n');
    expect(parsePsForegroundOutput(ps)).toBeNull();
  });

  it('handles a node-wrapped claude command (real-world: `node /usr/local/bin/claude`)', () => {
    const ps = [
      'Ss   -bash',
      'Sl+  node /home/dgordon/.nvm/versions/node/v22.0.0/bin/claude',
    ].join('\n');
    const parsed = parsePsForegroundOutput(ps);
    expect(parsed.command).toContain('node');
    expect(parsed.command).toContain('claude');
  });

  it('returns null on empty input', () => {
    expect(parsePsForegroundOutput('')).toBeNull();
    expect(parsePsForegroundOutput(null)).toBeNull();
  });
});

describe('isClaudeProcess', () => {
  it('matches the bare command `claude`', () => {
    expect(isClaudeProcess('claude')).toBe(true);
  });

  it('matches `claude --resume <uuid>`', () => {
    expect(isClaudeProcess('claude --resume abc-123')).toBe(true);
  });

  it('matches a node-wrapped claude.js invocation', () => {
    expect(isClaudeProcess('node /usr/lib/node_modules/claude-code/cli.js')).toBe(true);
    expect(isClaudeProcess('node /home/dgordon/.nvm/versions/node/v22.0.0/lib/node_modules/@anthropic-ai/claude-code/dist/claude.js')).toBe(true);
  });

  it('does NOT match bash, sh, or unrelated commands', () => {
    expect(isClaudeProcess('-bash')).toBe(false);
    expect(isClaudeProcess('bash')).toBe(false);
    expect(isClaudeProcess('sleep 1')).toBe(false);
    expect(isClaudeProcess('vim /etc/hosts')).toBe(false);
    expect(isClaudeProcess('node server.js')).toBe(false);
    expect(isClaudeProcess('node /tmp/server.js')).toBe(false);
  });

  it('does NOT match unrelated text just because it contains the word claude', () => {
    expect(isClaudeProcess('cat /tmp/claude-readme.txt')).toBe(false);
    expect(isClaudeProcess('grep claude /var/log/syslog')).toBe(false);
  });
});

describe('findNewestClaudeSession', () => {
  let tmp;
  beforeEach(async () => { tmp = await mkdtemp(join(tmpdir(), 'claude-sessions-')); });
  afterEach(async () => { if (tmp) await rm(tmp, { recursive: true, force: true }); });

  it('returns null when ~/.claude/projects/<slug>/ does not exist', () => {
    const result = findNewestClaudeSession({
      claudeProjectsDir: join(tmp, 'doesnotexist'),
      projectSlug: 'my-app',
    });
    expect(result).toBeNull();
  });

  it('returns null when the project dir is empty', async () => {
    await mkdir(join(tmp, 'my-app'), { recursive: true });
    const result = findNewestClaudeSession({
      claudeProjectsDir: tmp,
      projectSlug: 'my-app',
    });
    expect(result).toBeNull();
  });

  it('returns the session id (basename minus .jsonl) of the most-recently modified file', async () => {
    const dir = join(tmp, 'my-app');
    await mkdir(dir, { recursive: true });
    const older = join(dir, '11111111-2222-3333-4444-555555555555.jsonl');
    const newer = join(dir, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jsonl');
    await writeFile(older, '{}');
    await writeFile(newer, '{}');
    // Force older to be older by mtime.
    const past = new Date(Date.now() - 60_000);
    await utimes(older, past, past);
    const result = findNewestClaudeSession({
      claudeProjectsDir: tmp,
      projectSlug: 'my-app',
    });
    expect(result).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  });

  it('ignores non-jsonl files', async () => {
    const dir = join(tmp, 'my-app');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'something.txt'), 'noise');
    await writeFile(join(dir, 'aaaa.jsonl'), '{}');
    const result = findNewestClaudeSession({
      claudeProjectsDir: tmp,
      projectSlug: 'my-app',
    });
    expect(result).toBe('aaaa');
  });
});

describe('ClaudeDetector tick', () => {
  let tmp;
  beforeEach(async () => { tmp = await mkdtemp(join(tmpdir(), 'claude-detector-')); });
  afterEach(async () => { if (tmp) await rm(tmp, { recursive: true, force: true }); });

  function makeFakeManager(terminals) {
    return {
      _ts: new Map(terminals.map((t) => [t.id, t])),
      list() { return [...this._ts.values()]; },
      getTty(id) {
        const t = this._ts.get(id);
        return t?.tty ?? null;
      },
      inspect(id) { return this._ts.get(id) || null; },
    };
  }

  it('does nothing when no terminals are listed', async () => {
    const psStub = async () => '';
    const detector = new ClaudeDetector({
      manager: makeFakeManager([]),
      metaStore: { update: async () => {} },
      claudeProjectsDir: tmp,
      runPs: psStub,
    });
    await detector.tick();
    // no throw = success
  });

  it('persists claudeSessionId when foreground command matches claude AND a session exists on disk', async () => {
    // Pre-create a session file for slug 'demo'.
    await mkdir(join(tmp, 'demo'), { recursive: true });
    await writeFile(join(tmp, 'demo', 'abc-session.jsonl'), '{}');

    const manager = makeFakeManager([
      { id: 't1', projectSlug: 'demo', tty: '/dev/pts/42' },
    ]);
    let psCalledWith;
    const updates = [];
    const detector = new ClaudeDetector({
      manager,
      metaStore: { update: async (id, partial) => { updates.push({ id, partial }); } },
      claudeProjectsDir: tmp,
      runPs: async (tty) => { psCalledWith = tty; return 'Ss   -bash\nS+   claude'; },
    });

    await detector.tick();
    expect(psCalledWith).toBe('/dev/pts/42');
    expect(updates).toHaveLength(1);
    expect(updates[0]).toEqual({
      id: 't1',
      partial: { claudeSessionId: 'abc-session' },
    });
  });

  it('does NOT update meta when the foreground is bash / not claude', async () => {
    const manager = makeFakeManager([
      { id: 't1', projectSlug: 'demo', tty: '/dev/pts/42' },
    ]);
    const updates = [];
    const detector = new ClaudeDetector({
      manager,
      metaStore: { update: async (id, partial) => { updates.push({ id, partial }); } },
      claudeProjectsDir: tmp,
      runPs: async () => 'Ss+  -bash',
    });
    await detector.tick();
    expect(updates).toHaveLength(0);
  });

  it('does not call ps when the terminal has no tty (PTY not yet alive)', async () => {
    const manager = makeFakeManager([
      { id: 't1', projectSlug: 'demo', tty: null },
    ]);
    let calls = 0;
    const detector = new ClaudeDetector({
      manager,
      metaStore: { update: async () => {} },
      claudeProjectsDir: tmp,
      runPs: async () => { calls++; return ''; },
    });
    await detector.tick();
    expect(calls).toBe(0);
  });

  it('skips updates when the persisted claudeSessionId is already current', async () => {
    await mkdir(join(tmp, 'demo'), { recursive: true });
    await writeFile(join(tmp, 'demo', 'sid-1.jsonl'), '{}');

    const manager = makeFakeManager([
      { id: 't1', projectSlug: 'demo', tty: '/dev/pts/42', claudeSessionId: 'sid-1' },
    ]);
    const updates = [];
    const detector = new ClaudeDetector({
      manager,
      metaStore: { update: async (id, p) => { updates.push({ id, p }); } },
      claudeProjectsDir: tmp,
      runPs: async () => 'S+   claude',
    });
    await detector.tick();
    expect(updates).toHaveLength(0);
  });

  it('start/stop schedules ticks on an interval; stop clears the timer', async () => {
    // Use a manager with a terminal so the tick actually drives runPs.
    const manager = makeFakeManager([
      { id: 't1', projectSlug: 'demo', tty: '/dev/pts/42' },
    ]);
    let ticks = 0;
    const detector = new ClaudeDetector({
      manager,
      metaStore: { update: async () => {} },
      claudeProjectsDir: tmp,
      runPs: async () => { ticks++; return ''; },
      intervalMs: 10,
    });
    detector.start();
    await new Promise((r) => setTimeout(r, 50));
    detector.stop();
    const after = ticks;
    await new Promise((r) => setTimeout(r, 30));
    // After stop, no further ticks.
    expect(ticks).toBe(after);
    // Some ticks happened while running.
    expect(after).toBeGreaterThan(0);
  });
});
