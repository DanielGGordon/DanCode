#!/usr/bin/env bash
#
# Provision a project-local Android toolchain (JDK 17 + Android SDK) under
# android/.toolchain/.  The system Java install (1.8 on the Hetzner box) is
# left untouched: nothing is written outside this directory, no environment
# variables persist past the script's lifetime, and no global symlinks are
# created.  Idempotent — re-running re-uses anything already on disk.
#
# Layout produced:
#   android/.toolchain/jdk/                      JDK 17 (Temurin)
#   android/.toolchain/android-sdk/              Android SDK root
#   android/.toolchain/env.sh                    sourced by ./android/gradlew
#   android/local.properties                     sdk.dir=…  (consumed by AGP)
#
set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
ANDROID_DIR="$( cd "$SCRIPT_DIR/.." && pwd )"
TOOLCHAIN_DIR="$ANDROID_DIR/.toolchain"
JDK_DIR="$TOOLCHAIN_DIR/jdk"
SDK_DIR="$TOOLCHAIN_DIR/android-sdk"
CACHE_DIR="$TOOLCHAIN_DIR/cache"

# Pinned versions — change here, not inline.
JDK_VERSION="17.0.12+7"
JDK_URL="https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.12%2B7/OpenJDK17U-jdk_x64_linux_hotspot_17.0.12_7.tar.gz"
JDK_SHA256="9d4dd339bf7e6a9dcba8347661603b74c61ab2a5083ae67bf76da6285da8a778"

CMDLINE_TOOLS_URL="https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip"

# Android packages required for assembleDebug + Robolectric test runs.
SDK_BUILD_TOOLS_VERSION="34.0.0"
SDK_PLATFORM_VERSION="34"

log() { printf '[bootstrap-toolchain] %s\n' "$*" >&2; }

require_cmd() {
    for cmd in "$@"; do
        if ! command -v "$cmd" >/dev/null 2>&1; then
            log "ERROR: required command not found on PATH: $cmd"
            exit 1
        fi
    done
}

require_cmd curl tar unzip sha256sum

mkdir -p "$TOOLCHAIN_DIR" "$CACHE_DIR"

############################################################
# 1. JDK 17 — only installed if absent or wrong version.
############################################################
install_jdk() {
    local marker="$JDK_DIR/.installed-version"
    if [ -x "$JDK_DIR/bin/java" ] && [ -f "$marker" ] && [ "$(cat "$marker")" = "$JDK_VERSION" ]; then
        log "JDK 17 already present at $JDK_DIR ($JDK_VERSION)"
        return
    fi

    log "Installing JDK 17 ($JDK_VERSION) into $JDK_DIR"
    local tarball="$CACHE_DIR/jdk17.tar.gz"
    if [ ! -f "$tarball" ]; then
        curl -fL --retry 3 --retry-delay 5 -o "$tarball.part" "$JDK_URL"
        mv "$tarball.part" "$tarball"
    fi

    local actual_sha
    actual_sha="$(sha256sum "$tarball" | awk '{print $1}')"
    if [ "$actual_sha" != "$JDK_SHA256" ]; then
        log "ERROR: JDK tarball SHA-256 mismatch (got $actual_sha, expected $JDK_SHA256)"
        exit 1
    fi

    rm -rf "$JDK_DIR.tmp" "$JDK_DIR"
    mkdir -p "$JDK_DIR.tmp"
    tar -xzf "$tarball" -C "$JDK_DIR.tmp" --strip-components=1
    mv "$JDK_DIR.tmp" "$JDK_DIR"
    printf '%s' "$JDK_VERSION" > "$marker"
    log "JDK 17 ready: $($JDK_DIR/bin/java -version 2>&1 | head -n 1)"
}

############################################################
# 2. Android cmdline-tools — sdkmanager needs to live at
#    $SDK_ROOT/cmdline-tools/latest/ for the Gradle plugin
#    to find it.
############################################################
install_cmdline_tools() {
    local target="$SDK_DIR/cmdline-tools/latest"
    if [ -x "$target/bin/sdkmanager" ]; then
        log "Android cmdline-tools already present at $target"
        return
    fi

    log "Installing Android cmdline-tools into $target"
    local zip="$CACHE_DIR/commandlinetools.zip"
    if [ ! -f "$zip" ]; then
        curl -fL --retry 3 --retry-delay 5 -o "$zip.part" "$CMDLINE_TOOLS_URL"
        mv "$zip.part" "$zip"
    fi

    rm -rf "$SDK_DIR/cmdline-tools"
    mkdir -p "$SDK_DIR/cmdline-tools"
    unzip -q "$zip" -d "$SDK_DIR/cmdline-tools"
    # zip extracts to cmdline-tools/cmdline-tools/{bin,lib,…}; promote to latest/.
    mv "$SDK_DIR/cmdline-tools/cmdline-tools" "$target"
}

############################################################
# 3. SDK packages — platform-tools, platform, build-tools.
#    Licenses are accepted with `yes |` so the run is fully
#    non-interactive.
############################################################
install_sdk_packages() {
    local sdkmanager="$SDK_DIR/cmdline-tools/latest/bin/sdkmanager"
    local java_home="$JDK_DIR"

    export JAVA_HOME="$java_home"
    export PATH="$java_home/bin:$PATH"

    # Accept all currently-offered licenses first (idempotent).  `yes | …`
    # would tickle SIGPIPE under `set -o pipefail` when sdkmanager closes
    # stdin, so we disable pipefail just for the licenses pipeline.
    log "Accepting Android SDK licenses non-interactively"
    set +o pipefail
    yes | "$sdkmanager" --sdk_root="$SDK_DIR" --licenses >/dev/null
    set -o pipefail

    log "Installing SDK packages: platform-tools, platforms;android-$SDK_PLATFORM_VERSION, build-tools;$SDK_BUILD_TOOLS_VERSION"
    "$sdkmanager" --sdk_root="$SDK_DIR" \
        "platform-tools" \
        "platforms;android-$SDK_PLATFORM_VERSION" \
        "build-tools;$SDK_BUILD_TOOLS_VERSION" >/dev/null
}

############################################################
# 4. Generate env.sh + local.properties for Gradle to pick up.
############################################################
write_env_files() {
    cat > "$TOOLCHAIN_DIR/env.sh" <<EOF
# Generated by android/scripts/bootstrap-toolchain.sh — do not edit by hand.
# Sourced by ./android/gradlew so each invocation gets the project-local
# JDK 17 + Android SDK *without* mutating the user's shell environment.
export JAVA_HOME="$JDK_DIR"
export ANDROID_HOME="$SDK_DIR"
export ANDROID_SDK_ROOT="$SDK_DIR"
export PATH="\$JAVA_HOME/bin:\$ANDROID_HOME/cmdline-tools/latest/bin:\$ANDROID_HOME/platform-tools:\$PATH"
EOF

    cat > "$ANDROID_DIR/local.properties" <<EOF
# Generated by android/scripts/bootstrap-toolchain.sh — do not edit.
# Tells the Android Gradle Plugin where the project-local SDK lives.
sdk.dir=$SDK_DIR
EOF

    log "Wrote $TOOLCHAIN_DIR/env.sh and $ANDROID_DIR/local.properties"
}

install_jdk
install_cmdline_tools
install_sdk_packages
write_env_files

log "Toolchain ready. Run from this directory:"
log "  ./android/gradlew :app:assembleDebug"
log "  ./android/gradlew test"
