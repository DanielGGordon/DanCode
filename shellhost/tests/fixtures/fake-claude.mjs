#!/usr/bin/env node
/**
 * Tiny stand-in for the real `claude` binary, used by the Phase 7
 * integration test. Behaviour:
 *
 *   - Renames its own process title (argv0) to `claude` so that `ps` on the
 *     controlling tty reports `claude` as the foreground command. This is
 *     critical: the real claude binary is `node /…/claude.js`, but the
 *     detector specifically supports the bare `claude` case too, and for
 *     the integration test we want a deterministic match.
 *   - Touches `${CLAUDE_HOME}/projects/${slug}/<uuid>.jsonl` so the
 *     detector's findNewestClaudeSession returns the expected id.
 *   - Sleeps indefinitely until killed.
 *
 * Env vars:
 *   FAKE_CLAUDE_SLUG    — project slug under CLAUDE_HOME/projects/
 *   FAKE_CLAUDE_SESSION — session UUID (basename of the .jsonl file)
 *   CLAUDE_HOME         — directory used as ~/.claude for this test
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

try { process.title = 'claude'; } catch { /* best effort */ }

const slug = process.env.FAKE_CLAUDE_SLUG || 'default';
const sessionId = process.env.FAKE_CLAUDE_SESSION || 'fake-session';
const claudeHome = process.env.CLAUDE_HOME;
if (claudeHome) {
  const dir = join(claudeHome, 'projects', slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${sessionId}.jsonl`), '{"hello":"world"}\n');
}

process.stdout.write(`fake-claude started (slug=${slug} session=${sessionId})\n`);

// Sleep until killed.
const keepAlive = setInterval(() => {}, 60_000);
process.on('SIGTERM', () => { clearInterval(keepAlive); process.exit(0); });
process.on('SIGHUP', () => { clearInterval(keepAlive); process.exit(0); });
