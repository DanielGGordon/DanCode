/**
 * Phase 7: Claude-aware terminal detection.
 *
 * Periodically inspects each PTY's controlling tty for a foreground Claude
 * process. When the terminal is running Claude, scans
 * `~/.claude/projects/<projectSlug>/*.jsonl` for the newest session id and
 * records it in the terminal's meta.json via MetaStore.update.
 *
 * Design notes:
 *  - We use `ps` against the tty (`ps -o stat=,command= -t <tty-basename>`).
 *    The "+" suffix in the STAT column identifies the foreground process
 *    group; that is the row we care about. `ps` is invoked with a 1-shot
 *    flag set, so this is cheap. CPU budget is verified by an integration
 *    test (< 1% sustained).
 *  - All filesystem reads are synchronous + cheap (one readdirSync per
 *    Claude-active terminal). The interval defaults to 5s.
 */
import { spawn as spawnProc } from 'node:child_process';
import { readdirSync, statSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';

/**
 * Parse the output of `ps -o stat=,command= -t <tty>`. The row whose STAT
 * field ends with '+' is the foreground process. Returns { stat, command }
 * or null when no row carries the '+' marker.
 *
 * Each row is two whitespace-separated columns: STAT and COMMAND. The
 * COMMAND column itself can contain spaces (e.g. `node /a/b/c.js`), so we
 * split on the first run of whitespace only.
 */
export function parsePsForegroundOutput(text) {
  if (!text || typeof text !== 'string') return null;
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const m = trimmed.match(/^(\S+)\s+(.+)$/);
    if (!m) continue;
    const [, stat, command] = m;
    if (stat.includes('+')) return { stat, command: command.trim() };
  }
  return null;
}

/**
 * Returns true when `command` (as observed in ps output) is plausibly a
 * Claude Code invocation. We accept:
 *   - bare `claude` or `claude --foo bar`
 *   - `node /…/claude.js` / `node /…/claude-code/cli.js`
 *
 * Importantly we reject things like `cat claude-readme.txt` or
 * `grep claude /var/log/syslog` — the matching has to be on a token
 * boundary at the start of the executable.
 */
export function isClaudeProcess(command) {
  if (!command || typeof command !== 'string') return false;
  const cmd = command.trim();
  // Strip a leading `-` (login shell marker) before splitting.
  const head = cmd.split(/\s+/)[0] || '';
  const headBase = basename(head.replace(/^-/, ''));
  if (headBase === 'claude') return true;
  // node-wrapped: the head is `node`, and a later token ends in claude.js or
  // claude-code/{anything}.js or .../claude.
  if (headBase === 'node') {
    const parts = cmd.split(/\s+/).slice(1);
    for (const p of parts) {
      const b = basename(p);
      if (b === 'claude' || b === 'claude.js' || b === 'cli.js') {
        // For cli.js we additionally require the path to mention claude.
        if (b === 'cli.js' && !/claude/i.test(p)) continue;
        return true;
      }
      if (/claude/i.test(p) && /\.(js|mjs|cjs)$/.test(p)) return true;
    }
  }
  return false;
}

/**
 * Scan `<claudeProjectsDir>/<projectSlug>/*.jsonl` and return the basename
 * (minus `.jsonl`) of the file with the most recent mtime, or null when
 * nothing matches.
 */
export function findNewestClaudeSession({ claudeProjectsDir, projectSlug }) {
  if (!claudeProjectsDir || !projectSlug) return null;
  const dir = join(claudeProjectsDir, projectSlug);
  if (!existsSync(dir)) return null;
  let entries;
  try { entries = readdirSync(dir); }
  catch { return null; }
  let bestId = null;
  let bestMtime = -Infinity;
  for (const name of entries) {
    if (!name.endsWith('.jsonl')) continue;
    let mtime;
    try { mtime = statSync(join(dir, name)).mtimeMs; }
    catch { continue; }
    if (mtime > bestMtime) {
      bestMtime = mtime;
      bestId = name.slice(0, -'.jsonl'.length);
    }
  }
  return bestId;
}

/**
 * Returns true when `command` (a meta.command string) is a Claude shell
 * invocation we can safely rewrite to `claude --resume`. We use the same
 * head-token check as `isClaudeProcess` but the input here is a single
 * shell command string (no leading `-`).
 */
export function isClaudeCommand(command) {
  if (!command || typeof command !== 'string') return false;
  const head = command.trim().split(/\s+/)[0] || '';
  return basename(head) === 'claude';
}

/**
 * Build the shell command that resumes a Claude session. Throws when the
 * original command is not a Claude invocation or when sessionId is empty.
 *
 * Shell-quoting: if sessionId is a plain UUID/slug we pass it bare; if it
 * contains anything outside [A-Za-z0-9._-] we single-quote it. We expect
 * UUIDs in practice but defend against weirdness.
 */
export function buildClaudeResumeCommand(originalCommand, sessionId) {
  if (!isClaudeCommand(originalCommand)) {
    throw new Error('buildClaudeResumeCommand: original command is not a Claude invocation');
  }
  if (!sessionId || typeof sessionId !== 'string') {
    throw new Error('buildClaudeResumeCommand: sessionId is required');
  }
  const safe = /^[A-Za-z0-9._-]+$/.test(sessionId);
  const quoted = safe ? sessionId : `'${sessionId.replace(/'/g, "'\\''")}'`;
  return `claude --resume ${quoted}`;
}

/**
 * Default ps runner: shells out to `ps -o stat=,command= -t <tty>` and
 * returns stdout. We strip the `/dev/pts/` (or `/dev/tty`) prefix because
 * ps's `-t` flag wants just the device name suffix.
 */
async function defaultRunPs(tty) {
  if (!tty) return '';
  const dev = tty.replace(/^\/dev\//, '');
  return await new Promise((resolve) => {
    const proc = spawnProc('ps', ['-o', 'stat=,command=', '-t', dev], {
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    let out = '';
    proc.stdout.on('data', (chunk) => { out += chunk; });
    proc.on('error', () => resolve(''));
    proc.on('close', () => resolve(out));
  });
}

/**
 * Periodic detector. Owns:
 *   - the inspect interval (start/stop)
 *   - the per-tick "inspect every terminal, persist updates" logic
 *
 * Collaborators (injectable for tests):
 *   - manager: PTYManager-shaped object with `list()` + `getTty(id)` +
 *     `inspect(id)`.
 *   - metaStore: MetaStore with `update(id, partial)`.
 *   - runPs(tty): async string returner (mockable in tests).
 *   - claudeProjectsDir: where to look for session files. Defaults to
 *     ~/.claude/projects.
 */
export class ClaudeDetector {
  constructor({
    manager,
    metaStore,
    claudeProjectsDir = join(homedir(), '.claude', 'projects'),
    runPs = defaultRunPs,
    intervalMs = 5000,
  } = {}) {
    if (!manager) throw new TypeError('ClaudeDetector: manager is required');
    if (!metaStore) throw new TypeError('ClaudeDetector: metaStore is required');
    this.manager = manager;
    this.metaStore = metaStore;
    this.claudeProjectsDir = claudeProjectsDir;
    this.runPs = runPs;
    this.intervalMs = intervalMs;
    this._timer = null;
    this._ticking = false;
  }

  start() {
    if (this._timer) return;
    this._timer = setInterval(() => {
      if (this._ticking) return; // skip if previous tick hasn't finished
      this._ticking = true;
      this.tick()
        .catch(() => {})
        .finally(() => { this._ticking = false; });
    }, this.intervalMs);
    if (this._timer?.unref) this._timer.unref();
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  /**
   * One inspection sweep across every terminal the manager knows about.
   * - Terminals without a live tty are skipped.
   * - When the foreground command is Claude, we look up the newest session
   *   id on disk and (if it differs from what's already persisted) update
   *   the terminal's meta.json.
   */
  async tick() {
    const terminals = this.manager.list?.() || [];
    for (const t of terminals) {
      if (!t?.id) continue;
      const tty = this.manager.getTty?.(t.id) ?? t.tty ?? null;
      if (!tty) {
        // Needs-respawn terminals: their last-known claudeActive value
        // shouldn't change.
        continue;
      }
      let psOut;
      try { psOut = await this.runPs(tty); }
      catch { continue; }
      const parsed = parsePsForegroundOutput(psOut);
      const claudeFg = parsed ? isClaudeProcess(parsed.command) : false;

      // Track active/idle state on the in-memory record (not persisted).
      if (typeof this.manager.setClaudeActive === 'function') {
        try { this.manager.setClaudeActive(t.id, claudeFg); } catch { /* ignore */ }
      }

      if (!claudeFg) continue;
      const sessionId = findNewestClaudeSession({
        claudeProjectsDir: this.claudeProjectsDir,
        projectSlug: t.projectSlug,
      });
      if (!sessionId) continue;
      const existing = this.manager.inspect?.(t.id);
      const current = existing?.claudeSessionId ?? t.claudeSessionId ?? null;
      if (current === sessionId) continue;
      // Persist via the store; also mutate the in-memory record if the
      // manager exposes a setter.
      try { await this.metaStore.update(t.id, { claudeSessionId: sessionId }); }
      catch { /* best effort */ }
      if (typeof this.manager.setClaudeSessionId === 'function') {
        try { this.manager.setClaudeSessionId(t.id, sessionId); }
        catch { /* ignore */ }
      }
    }
  }
}
