#!/usr/bin/env bash
# Install the DanCode systemd --user units into ~/.config/systemd/user/.
#
# Usage:
#   bash systemd/install.sh                  # uses repo root as DANCODE_REPO
#   DANCODE_REPO=/srv/dancode systemd/install.sh
#
# The unit files in this directory use the placeholder /opt/dancode for their
# absolute paths. This installer rewrites that placeholder to the real repo
# path (default: the parent of this script's directory) so users don't have
# to edit the units by hand.
#
# After installation the unit is enabled and started. To make it survive
# logout / Pi reboot, also run:
#
#   loginctl enable-linger "$USER"
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DANCODE_REPO="${DANCODE_REPO:-$(cd "$SCRIPT_DIR/.." && pwd)}"
UNIT_DIR="${UNIT_DIR:-$HOME/.config/systemd/user}"

mkdir -p "$UNIT_DIR"

install_unit() {
  local src="$1"
  local name
  name="$(basename "$src")"
  local dest="$UNIT_DIR/$name"
  # Rewrite the absolute repo placeholder to the actual install path.
  sed "s|/opt/dancode|$DANCODE_REPO|g" "$src" > "$dest"
  echo "wrote $dest (ExecStart -> $DANCODE_REPO)"
}

install_unit "$SCRIPT_DIR/dancode-shellhost.service"

# The server unit is optional — install it only if the user wants the web
# server supervised too. Defaults to ON; set DANCODE_INSTALL_SERVER=0 to skip.
if [ "${DANCODE_INSTALL_SERVER:-1}" = "1" ]; then
  install_unit "$SCRIPT_DIR/dancode-server.service"
fi

systemctl --user daemon-reload
systemctl --user enable --now dancode-shellhost.service

if [ "${DANCODE_INSTALL_SERVER:-1}" = "1" ]; then
  systemctl --user enable --now dancode-server.service || true
fi

cat <<EOF

DanCode units installed and enabled.
To make them survive logout / reboot, run:
  loginctl enable-linger "\$USER"

Verify with:
  systemctl --user status dancode-shellhost
  node "$DANCODE_REPO/bin/dancode-healthcheck.mjs"
EOF
