#!/usr/bin/env bash
# Phase 10 systemd-in-Docker integration test, executed inside the container.
#
# Performs the README-documented production install, then verifies:
#   1. The unit is `active` after `systemctl --user enable --now`.
#   2. `bin/dancode-healthcheck` passes.
#   3. Killing the shellhost process (simulating a crash) is auto-recovered
#      by systemd within 5 seconds.
#   4. Healthcheck passes again after auto-restart.
#   5. Reboot-equivalent stop/start works and a spawned terminal survives.
#
# The script must run as the `dancode` user (uid != 0) so `systemctl --user`
# is the right bus. Linger is pre-enabled in the Dockerfile.
set -euo pipefail

# Print every command for debug visibility in CI logs.
export PS4='+ [$BASH_SOURCE:$LINENO] '
set -x

REPO_DIR="${REPO_DIR:-/opt/dancode}"
RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export XDG_RUNTIME_DIR="$RUNTIME_DIR"
export DBUS_SESSION_BUS_ADDRESS="unix:path=$RUNTIME_DIR/bus"

# Wait for `systemd --user` to come up.
for i in $(seq 1 30); do
  if systemctl --user is-system-running >/dev/null 2>&1 \
       || systemctl --user list-units >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
systemctl --user list-units --no-pager | head -5 || true

cd "$REPO_DIR"

# README install steps.
mkdir -p "$HOME/.config/systemd/user"
DANCODE_REPO="$REPO_DIR" UNIT_DIR="$HOME/.config/systemd/user" \
  bash systemd/install.sh

# Verify the unit is active.
sleep 2
systemctl --user status dancode-shellhost --no-pager || true
state=$(systemctl --user is-active dancode-shellhost)
if [ "$state" != "active" ]; then
  echo "FAIL: unit not active after install (got $state)" >&2
  systemctl --user status dancode-shellhost --no-pager || true
  exit 1
fi
echo "OK: unit active after install"

# Healthcheck #1 — we don't start the server in this container, so we point at
# a stub server that the wrapper script spins up. The wrapper exports
# DANCODE_SERVER_URL; healthcheck uses it.
if ! node bin/dancode-healthcheck.mjs; then
  echo "FAIL: initial healthcheck failed" >&2
  exit 1
fi
echo "OK: initial healthcheck passed"

# Kill the shellhost process to simulate a crash.
old_pid=$(systemctl --user show -p MainPID --value dancode-shellhost)
if [ -z "$old_pid" ] || [ "$old_pid" = "0" ]; then
  echo "FAIL: could not read MainPID of dancode-shellhost" >&2
  exit 1
fi
echo "Killing shellhost PID $old_pid"
kill -KILL "$old_pid"

# Poll for restart. Restart=on-failure with RestartSec=1; should be < 5s.
deadline=$(( $(date +%s) + 8 ))
new_pid=""
while [ "$(date +%s)" -lt "$deadline" ]; do
  candidate=$(systemctl --user show -p MainPID --value dancode-shellhost || true)
  state=$(systemctl --user is-active dancode-shellhost || true)
  if [ -n "$candidate" ] && [ "$candidate" != "0" ] \
     && [ "$candidate" != "$old_pid" ] && [ "$state" = "active" ]; then
    new_pid="$candidate"
    break
  fi
  sleep 0.5
done

if [ -z "$new_pid" ]; then
  echo "FAIL: shellhost did not auto-restart within 8s" >&2
  systemctl --user status dancode-shellhost --no-pager || true
  exit 1
fi
echo "OK: shellhost restarted ($old_pid -> $new_pid)"

# Healthcheck #2 — must pass against the new shellhost PID.
# Give it a moment to bind the socket.
for i in $(seq 1 10); do
  if [ -S "$HOME/.dancode/shellhost.sock" ]; then break; fi
  sleep 0.5
done
if ! node bin/dancode-healthcheck.mjs; then
  echo "FAIL: post-restart healthcheck failed" >&2
  exit 1
fi
echo "OK: post-restart healthcheck passed"

# Pre-spawn a terminal so we can assert it survives the reboot equivalent.
# We use the shellhost client directly (the same code path the dancode-server
# uses), bypassing the HTTP layer because this container intentionally does
# not boot dancode-server — Phase 5 already covers the server-side respawn
# wiring end to end; this leg confirms the *unit* preserves meta + scrollback
# across a stop/start.
node --input-type=module -e "
  import { createShellhostClient } from '/opt/dancode/shellhost/src/client.js';
  const c = createShellhostClient({ socketPath: process.env.HOME + '/.dancode/shellhost.sock' });
  await c.connect();
  const res = await c.spawn({ projectSlug: 'fixture', cwd: '/tmp', command: 'bash' });
  await c.attach(res.terminalId);
  await c.write(res.terminalId, 'echo REBOOT_FIXTURE_MARKER\n');
  await new Promise(r => setTimeout(r, 500));
  process.stderr.write('spawned ' + res.terminalId + '\n');
  process.stdout.write(res.terminalId);
  c.close();
" > /tmp/fixture-terminal-id
fixture_terminal_id=$(cat /tmp/fixture-terminal-id)
echo "Pre-reboot fixture terminal id: $fixture_terminal_id"
test -d "$HOME/.dancode/terminals/$fixture_terminal_id"
test -f "$HOME/.dancode/terminals/$fixture_terminal_id/meta.json"

# Reboot-equivalent: stop+start, verify unit comes back active.
systemctl --user stop dancode-shellhost
# Poll for inactive — `systemctl stop` returns after SIGTERM is sent but the
# shellhost's graceful shutdown can take a moment to release the socket.
for i in $(seq 1 20); do
  state=$(systemctl --user is-active dancode-shellhost || true)
  if [ "$state" != "active" ] && [ "$state" != "deactivating" ]; then break; fi
  sleep 0.5
done
state=$(systemctl --user is-active dancode-shellhost || true)
if [ "$state" = "active" ]; then
  echo "FAIL: unit still active after stop (got $state)" >&2
  exit 1
fi
systemctl --user start dancode-shellhost

for i in $(seq 1 10); do
  state=$(systemctl --user is-active dancode-shellhost || true)
  if [ "$state" = "active" ] && [ -S "$HOME/.dancode/shellhost.sock" ]; then break; fi
  sleep 0.5
done
state=$(systemctl --user is-active dancode-shellhost)
if [ "$state" != "active" ]; then
  echo "FAIL: unit not active after stop+start (got $state)" >&2
  exit 1
fi
echo "OK: unit active after stop+start"

if ! node bin/dancode-healthcheck.mjs; then
  echo "FAIL: post-reboot healthcheck failed" >&2
  exit 1
fi
echo "OK: post-reboot healthcheck passed"

# Reboot-equivalent assertion: the pre-reboot terminal's meta + scrollback
# should still be on disk, and the freshly-restarted shellhost should expose
# it via list() as a needsRespawn entry. This is the Phase 5 contract.
FIXTURE_TID="$fixture_terminal_id" node --input-type=module -e "
  import { createShellhostClient } from '/opt/dancode/shellhost/src/client.js';
  const c = createShellhostClient({ socketPath: process.env.HOME + '/.dancode/shellhost.sock' });
  await c.connect();
  const { terminals } = await c.list();
  const tid = process.env.FIXTURE_TID;
  console.error('Terminals reported by new shellhost:', terminals.map(t => t.id));
  const found = (terminals || []).find(t => t.id === tid);
  if (!found) { console.error('FAIL: pre-reboot terminal not found in list()'); process.exit(1); }
  if (!found.needsRespawn) { console.error('FAIL: terminal not flagged needsRespawn'); process.exit(1); }
  console.log('OK: pre-reboot terminal preserved as needsRespawn after stop+start');
  // Drive a respawn through the public op, simulating what dancode-server
  // does on the next project open.
  const res = await c.respawn(tid);
  if (!res || !res.ok) { console.error('FAIL: respawn rejected:', JSON.stringify(res)); process.exit(1); }
  console.log('OK: respawn() returned', JSON.stringify(res.terminal && {id: res.terminal.id, command: res.terminal.command}));
  // Verify the respawned terminal is now live (no longer needsRespawn).
  const post = (await c.list()).terminals.find(t => t.id === tid);
  if (!post || post.needsRespawn) { console.error('FAIL: terminal still needsRespawn after respawn()'); process.exit(1); }
  console.log('OK: terminal is live after respawn()');
  c.close();
"

echo "ALL INTEGRATION CHECKS PASSED"
