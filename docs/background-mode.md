# Background mode

Background mode is an opt-in per-terminal toggle that wraps the underlying
shell command in a transient `systemd --user` scope. The scope is owned by
systemd-user, not by `dancode-shellhost`, so killing or restarting shellhost
does **not** tear down the underlying process. Long-running jobs (builds,
training runs, file syncs) can therefore survive a shellhost restart, a
DanCode upgrade, or a brief Pi reboot without dying mid-run.

## When to use it

Use background mode for terminals whose command:

- Runs for many minutes or hours and you do not want it to be killed by a
  shellhost restart, accidental browser close, or transient network blip.
- Is idempotent or check-pointed (so it is OK if you have to attach a
  fresh shell to it later rather than seeing live output continuously).
- Writes its progress to disk (file, log, marker, journal) rather than
  relying on its stdout being captured by DanCode in real time.

Use foreground mode (the default) for:

- Interactive editors, REPLs, AI assistants like `claude`, anything where
  you need to see live output and type into a live prompt.
- Short commands.
- Anything that you want to be cleaned up cleanly when DanCode goes down.

## How to enable it

There are two ways to enable background mode:

### At creation time

```bash
curl -X POST http://localhost:3000/api/terminals \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "projectSlug": "my-proj",
    "label": "Long build",
    "command": "make -j8 release",
    "background": true
  }'
```

### Toggle on an existing terminal

```bash
curl -X POST http://localhost:3000/api/terminals/$ID/background \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"background": true}'
```

The flag is persisted to the terminal's `meta.json` immediately. It takes
effect on the underlying PTY the next time the terminal is respawned — for
example, after a Pi reboot. Toggling does **not** restart a live terminal;
its current shell keeps running until it exits or is killed.

In the DanCode UI, every terminal whose `background` flag is `true` shows
a small yellow `BG` badge next to its label (both in split panes and in
the tabs row).

## How it works under the hood

Shellhost wraps the PTY's command roughly like this:

```text
systemd-run --user --scope --quiet \
  --unit=dancode-bg-<terminalId> \
  setsid --wait \
  $SHELL -lc "trap '' HUP; <user command>"
```

- `--scope` registers the calling process in a new systemd scope rather
  than launching a new service. The scope's lifecycle is owned by
  systemd-user.
- `--unit=dancode-bg-<terminalId>` names the scope after the terminal id
  so a later `systemctl --user stop` can target it precisely.
- `setsid --wait` puts the user command in a brand-new session with no
  controlling terminal. When shellhost dies and node-pty closes the PTY
  master, the kernel sends SIGHUP to the foreground process group of the
  now-dead controlling terminal — but the user command is in a different
  session, so it does not receive the signal.
- `trap '' HUP` is a belt-and-braces guard inside the wrapped shell so
  that even if it shares a process group with the dying PTY in some odd
  configuration, it ignores the hangup.

When a background terminal is killed via the normal API
(`DELETE /api/terminals/:id` or the in-app close button), shellhost first
kills the PTY then issues `systemctl --user stop dancode-bg-<id>.scope`,
which tears the scope down. The `.scope` suffix is required — without it
systemctl defaults to `.service` and silently no-ops.

## What survives a shellhost restart

After a shellhost restart (or a Pi reboot, or a `systemctl --user restart
dancode-shellhost`):

- The systemd scope and all its processes keep running until they exit
  on their own.
- `meta.json` records that the terminal was in background mode, so the
  next time the project is opened, the server respawns the terminal with
  background mode still on.
- The respawned PTY connects to a fresh shell session, NOT to the
  surviving background command's stdio. Use the command's own log file,
  marker file, or `journalctl --user-unit=dancode-bg-<id>` to inspect
  progress.
- On the next session, `systemctl --user is-active dancode-bg-<id>.scope`
  will still report `active` if the background command is still running.

## Caveats

- **Requires systemd --user.** On a system without a logind user session
  (some containers, certain BSDs), `systemd-run --user --scope` will
  fail; the terminal will fail to spawn. Background mode is a Linux-only
  feature.
- **No live stdio after shellhost dies.** The PTY master is owned by
  shellhost; once shellhost goes down, the user command's stdout/stderr
  has nowhere to go. Make sure long-running commands write progress to
  disk if you need to see it later.
- **Stays running until explicitly stopped.** If you forget about a
  background terminal, the scope keeps running. `systemctl --user list-units
  'dancode-bg-*'` lists everything dangling so you can clean up.
- **Toggle doesn't restart the PTY.** If you turn on background mode on
  a live foreground terminal, the current shell still runs in foreground
  mode. Background mode kicks in on next respawn (e.g. after a reboot).

## Related tests

- `shellhost/tests/background.test.js` — unit tests for the spawn
  wrapping, `setBackground` op, and the systemctl-stop kill path.
- `shellhost/tests/background-integration.test.js` — real-systemd
  integration test that spawns a background terminal, SIGKILLs shellhost
  mid-sleep, and asserts the underlying command still completes.
- `server/tests/background.test.js` — server-side HTTP API tests for the
  `background` flag on `POST /api/terminals` and the
  `POST /api/terminals/:id/background` toggle endpoint.
