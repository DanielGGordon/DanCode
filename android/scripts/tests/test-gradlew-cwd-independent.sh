#!/usr/bin/env bash
#
# Asserts that `android/gradlew` works regardless of the caller's CWD.
# The acceptance criterion runs `android/gradlew :app:assembleDebug` from
# the project root; previously this failed because Gradle looked for
# settings.gradle.kts in the project root instead of in android/.
#
set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
ANDROID_DIR="$( cd "$SCRIPT_DIR/../.." && pwd )"
PROJECT_ROOT="$( cd "$ANDROID_DIR/.." && pwd )"

fail() { printf '[FAIL] %s\n' "$*" >&2; exit 1; }
pass() { printf '[PASS] %s\n' "$*"; }

# 1. From project root, `android/gradlew --version` should succeed and
#    not complain about a missing settings.gradle.
cd "$PROJECT_ROOT"
out="$(android/gradlew --version 2>&1)" || fail "--version from project root: $out"
echo "$out" | grep -q "^Gradle " || fail "--version did not print Gradle banner"
pass "android/gradlew --version works from project root"

# 2. From project root, `android/gradlew help` (which loads the build)
#    must succeed — this is the case that used to break with
#    'Directory ... does not contain a Gradle build'.
out="$(android/gradlew help 2>&1)" || fail "help from project root: $out"
echo "$out" | grep -q "does not contain a Gradle build" \
    && fail "gradle still cannot locate the build dir from project root"
pass "android/gradlew help locates the android/ project from project root"

# 3. From an unrelated CWD, the same invocation should still work.
cd /tmp
out="$("$PROJECT_ROOT/android/gradlew" --version 2>&1)" || fail "--version from /tmp: $out"
echo "$out" | grep -q "^Gradle " || fail "--version from /tmp did not print Gradle banner"
pass "android/gradlew --version works from /tmp"

printf '\nAll gradlew cwd-independence checks passed.\n'
