#!/usr/bin/env bash
# Host-side runner for the Phase 10 systemd integration test.
#
# - Builds the systemd-in-Docker image from the sibling Dockerfile.
# - Mounts the repo into /opt/dancode (read-only).
# - Spins up a tiny background HTTP "stub server" so the healthcheck's
#   /api/auth/setup/status probe has something to talk to (we deliberately
#   do not boot the full dancode-server inside the container because this
#   test is about the shellhost unit, not the web server).
# - Runs `run-in-container.sh` inside the container and propagates its exit
#   code.
#
# Usage:
#   bash systemd/integration-test/run.sh
#
# CI-friendly: returns 0 on success, non-zero on failure, with all logs on
# stdout/stderr.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
IMAGE_TAG="${IMAGE_TAG:-dancode-systemd-it:latest}"
CONTAINER_NAME="${CONTAINER_NAME:-dancode-systemd-it-$$}"

echo "==> Building integration image $IMAGE_TAG"
docker build -t "$IMAGE_TAG" "$SCRIPT_DIR"

cleanup() {
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "==> Installing repo deps (host) so the container's bind-mount has node_modules"
( cd "$REPO_ROOT" && npm install --no-audit --no-fund --silent ) >/dev/null

echo "==> Starting container $CONTAINER_NAME"
# Privileged + cgroup mounts are needed for systemd as PID 1 in Docker.
# We use a bind mount (rw) so the test sees the repo + node_modules.
docker run -d \
  --name "$CONTAINER_NAME" \
  --privileged \
  --tmpfs /tmp --tmpfs /run --tmpfs /run/lock \
  -v /sys/fs/cgroup:/sys/fs/cgroup:rw \
  --cgroupns=host \
  -v "$REPO_ROOT:/opt/dancode:rw" \
  "$IMAGE_TAG" >/dev/null

# Wait for systemd to be running.
for i in $(seq 1 30); do
  if docker exec "$CONTAINER_NAME" systemctl is-system-running >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
docker exec "$CONTAINER_NAME" systemctl is-system-running || true

# Manually start `user@<uid>` so `systemctl --user` works as that user.
# In a real Pi this happens automatically via PAM on login; here we trigger
# it explicitly (linger is enabled in the Dockerfile).
DANCODE_UID=$(docker exec "$CONTAINER_NAME" id -u dancode | tr -d '\r\n')
docker exec "$CONTAINER_NAME" systemctl start "user@${DANCODE_UID}.service"

# Wait for the per-user systemd manager to appear.
for i in $(seq 1 20); do
  if docker exec "$CONTAINER_NAME" \
       bash -c "[ -S /run/user/${DANCODE_UID}/bus ]"; then
    break
  fi
  sleep 0.5
done

# Start a tiny Node stub server inside the container (as dancode user) that
# answers /api/auth/setup/status so the healthcheck's HTTP probe is meaningful.
STUB_PORT=3000
docker exec -d -u dancode \
  -e XDG_RUNTIME_DIR="/run/user/${DANCODE_UID}" \
  -e DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/${DANCODE_UID}/bus" \
  "$CONTAINER_NAME" \
  /usr/bin/env node -e "
    const http = require('http');
    http.createServer((req, res) => {
      if (req.url === '/api/auth/setup/status') {
        res.writeHead(200, {'content-type': 'application/json'});
        res.end(JSON.stringify({setupComplete: false}));
      } else {
        res.writeHead(404).end();
      }
    }).listen($STUB_PORT, '127.0.0.1');
    setInterval(() => {}, 1e9);
  "

# Give the stub a beat to listen.
sleep 2

echo "==> Executing run-in-container.sh as dancode user"
set +e
docker exec -u dancode \
  -e DANCODE_SERVER_URL="http://127.0.0.1:$STUB_PORT" \
  -e REPO_DIR=/opt/dancode \
  -e XDG_RUNTIME_DIR="/run/user/${DANCODE_UID}" \
  -e DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/${DANCODE_UID}/bus" \
  -e HOME=/home/dancode \
  "$CONTAINER_NAME" \
  bash /opt/dancode/systemd/integration-test/run-in-container.sh
rc=$?
set -e

echo "==> Final container journal (last 60 lines)"
docker exec -u dancode \
  -e XDG_RUNTIME_DIR="/run/user/${DANCODE_UID}" \
  -e DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/${DANCODE_UID}/bus" \
  "$CONTAINER_NAME" \
  journalctl --user -u dancode-shellhost --no-pager -n 60 2>&1 | tail -80 || true

if [ "$rc" -eq 0 ]; then
  echo "==> PASS"
else
  echo "==> FAIL (rc=$rc)"
fi
exit "$rc"
