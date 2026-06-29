#!/usr/bin/env bash
# Install the DanCode reverse-proxy Caddy config.  Run this on the Hetzner
# box once after generate-cert.sh; reruns are idempotent.
#
# Lays out:
#   /etc/caddy/Caddyfile                 (this Caddyfile, by symlink)
#   /etc/caddy/dancode-server.crt        (cert from reverse-proxy/certs)
#   /etc/caddy/dancode-server.key        (key  from reverse-proxy/certs)
#   /var/lib/dancode-apk/                (Caddy serves under /downloads/)
#
# Does not start Caddy — assumes the system Caddy systemd unit is already
# running and will pick up the new Caddyfile via `systemctl reload caddy`.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
REVPROXY="$REPO_ROOT/android/reverse-proxy"
CERT="$REVPROXY/certs/server.crt"
KEY="$REVPROXY/certs/server.key"

[ -f "$CERT" ] || { echo "Cert not found: $CERT — run scripts/generate-cert.sh first" >&2; exit 1; }
[ -f "$KEY"  ] || { echo "Key  not found: $KEY  — run scripts/generate-cert.sh first" >&2; exit 1; }

SUDO=""
[ "$EUID" -ne 0 ] && SUDO=sudo

$SUDO install -m 0644 "$CERT" /etc/caddy/dancode-server.crt
$SUDO install -m 0600 "$KEY"  /etc/caddy/dancode-server.key
$SUDO ln -sf "$REVPROXY/Caddyfile" /etc/caddy/Caddyfile
$SUDO mkdir -p /var/lib/dancode-apk
$SUDO chown caddy:caddy /var/lib/dancode-apk 2>/dev/null || true

$SUDO caddy validate --config /etc/caddy/Caddyfile

echo
echo "Caddyfile installed; run:  sudo systemctl reload caddy"
echo "Then publish an APK with:   reverse-proxy/scripts/publish-apk.sh"
