#!/usr/bin/env bash
# Build the Android debug APK and copy it (plus a `previous` snapshot of
# whatever was there before) into the directory Caddy serves under
# /downloads/.  Run on the Hetzner box after merging a phase that should
# be sideloadable.
#
# - Current build: /var/lib/dancode-apk/dancode-android-debug.apk
# - Previous build: /var/lib/dancode-apk/dancode-android-debug.previous.apk
#   (lets you roll back by re-sideloading the prior APK — see plan.md
#    "Deployment / Rollback").
#
# Override DST_DIR to publish into a different directory.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
DST_DIR="${DST_DIR:-/var/lib/dancode-apk}"
CURRENT="$DST_DIR/dancode-android-debug.apk"
PREVIOUS="$DST_DIR/dancode-android-debug.previous.apk"

cd "$REPO_ROOT/android"
./gradlew :app:assembleDebug

APK="$REPO_ROOT/android/app/build/outputs/apk/debug/app-debug.apk"
[ -f "$APK" ] || { echo "Build did not produce $APK" >&2; exit 1; }

mkdir -p "$DST_DIR"
if [ -f "$CURRENT" ]; then
    mv -f "$CURRENT" "$PREVIOUS"
fi
cp "$APK" "$CURRENT"

echo "Published: $CURRENT"
[ -f "$PREVIOUS" ] && echo "Rollback : $PREVIOUS"
