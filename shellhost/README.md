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
  `resize`, `kill`, `list`, `inspect`).
- `res` — response from shellhost (success: `{ ok: true, result }`, failure:
  `{ ok: false, error }`).
- `event` — push from shellhost to server (`output`, `exit`).

See `src/wire.js` for the codec and `src/server.js` for the op handlers.

## Layout

- `src/wire.js` — frame encode/decode.
- `src/pty-manager.js` — owns the in-memory map of PTYs.
- `src/server.js` — UNIX-socket server + op dispatch.
- `src/index.js` — entry point: starts a server on `DANCODE_SHELLHOST_SOCKET`
  (defaults to `~/.dancode/shellhost.sock`).
- `src/client.js` — client library used by `dancode-server` to call into shellhost.
- `bin/dancode-shellhost.js` — CLI entry alias for `src/index.js`.

## Running

```bash
npm run dev -w shellhost   # foreground, auto-reload
npm run start -w shellhost # foreground, no reload
```

The socket parent directory is created on demand. Tests boot a fresh shellhost on a
temp socket and tear it down via `process.kill`.
