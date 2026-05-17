# dancode-shellhost

Standalone Node process that owns PTYs for DanCode terminals and speaks the DanCode
wire protocol over a UNIX domain socket.

## Architecture

`dancode-server` (HTTP/WebSocket) and `dancode-shellhost` (PTY owner) are two long-lived
processes. They communicate via length-prefixed JSON frames over `~/.dancode/shellhost.sock`
(overridable with `DANCODE_SHELLHOST_SOCKET`). Disconnecting the server from the socket
MUST NOT kill PTYs; only an explicit `kill` op does.

## Wire protocol

Every frame is `{ type, requestId?, terminalId?, op, payload }` encoded as JSON,
prefixed by a 4-byte big-endian length. Three frame types:

- `req` — request from server to shellhost (`spawn`, `attach`, `detach`, `write`,
  `resize`, `kill`, `list`, `inspect`, `getScrollback`, `respawn`, `noteClaudeSession`, `setBackground`).
- `res` — response from shellhost (success: `{ ok: true, result }`, failure:
  `{ ok: false, error }`).
- `event` — push from shellhost to server (`output`, `exit`).

On `attach`, shellhost streams the disk scrollback tail (last ~50KB across the
current log + one rotated file) as `output` events before forwarding live PTY
output. `getScrollback` returns the same tail without registering a live
listener — used by the server to replay history to additional browser
connections without duplicating live output.

See `src/wire.js` for the codec and `src/server.js` for the op handlers.

## Layout

- `src/wire.js` — frame encode/decode.
- `src/pty-manager.js` — owns the in-memory map of PTYs (live + `needsRespawn`
  orphans recovered from disk); routes every output chunk through the
  scrollback store synchronously before notifying listeners. `respawn(id)`
  persists a yellow banner (`--- prior session ended at <ISO> ---`) into
  scrollback, emits it to attached listeners, then spawns a fresh PTY at
  the saved cwd/command. A periodic flusher (default 60s) writes
  `lastActiveAt` from in-memory back to `meta.json` so the banner shows an
  accurate timestamp after a Pi reboot. Phase 8 adds opt-in background
  mode: `spawn({ background: true })` wraps the command via
  `systemd-run --user --scope --unit=dancode-bg-<id> setsid --wait $SHELL -lc <cmd>`
  so the underlying process survives shellhost SIGKILL; `setBackground(id)`
  toggles the flag without restarting the PTY; `kill` on a background
  terminal also invokes `systemctl --user stop dancode-bg-<id>.scope`.
- `src/scrollback.js` — `ScrollbackStore`: append-only `<terminalsDir>/<id>/scrollback.log`
  with 1MB rotation (one rotation kept as `scrollback.log.1`) and tail
  reads spanning both files in chronological order.
- `src/meta-store.js` — `MetaStore`: per-terminal `<terminalsDir>/<id>/meta.json`
  written atomically (write-tmp + rename). On startup `loadOrphans()` scans
  this directory and registers each terminal as `needsRespawn` so a fresh
  `dancode-shellhost` can resume after `systemctl --user restart` or any
  hard kill.
- `src/claude-detector.js` — Phase 7 `ClaudeDetector`: periodic (5s by
  default; override via `DANCODE_CLAUDE_INTERVAL_MS`) inspector that runs
  `ps -o stat=,command= -t <tty>` on each PTY's controlling tty. When the
  foreground process is `claude` (or `node …/claude.js`), it scans
  `<DANCODE_CLAUDE_HOME>/projects/<slug>/*.jsonl` (defaults to
  `~/.claude/projects/<slug>/`) for the most-recently-modified session
  file and persists its basename into `meta.claudeSessionId` via
  `MetaStore.update`. Also tracks the live `claudeActive` flag (not
  persisted) so the UI can decide whether to show the "Resume Claude"
  button. Helpers: `parsePsForegroundOutput`, `isClaudeProcess`,
  `findNewestClaudeSession`, `isClaudeCommand`, `buildClaudeResumeCommand`.
  `PTYManager.respawn` consults `meta.claudeSessionId` and rewrites the
  spawn command to `claude --resume <id>` when applicable (the original
  `meta.command` is preserved for future detection).
- `src/server.js` — UNIX-socket server + op dispatch.
- `src/index.js` — entry point: starts a server on `DANCODE_SHELLHOST_SOCKET`
  (defaults to `~/.dancode/shellhost.sock`) with scrollback + meta under
  `DANCODE_TERMINALS_DIR` (defaults to `~/.dancode/terminals/`). Drops a
  pidfile at `DANCODE_SHELLHOST_PIDFILE` (defaults to a sibling of the
  socket) so a co-located server or test orchestrator can SIGKILL the
  shellhost to simulate a Pi reboot.
- `src/client.js` — client library used by `dancode-server` to call into shellhost.
- `bin/dancode-shellhost.js` — CLI entry alias for `src/index.js`.

## Running

```bash
npm run dev -w shellhost   # foreground, auto-reload
npm run start -w shellhost # foreground, no reload
```

The socket parent directory is created on demand. Tests boot a fresh shellhost on a
temp socket and tear it down via `process.kill`.
