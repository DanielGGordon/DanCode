# :terminal-view

Vendored from [`termux/termux-app`](https://github.com/termux/termux-app)
@ commit `401bbe54` (June 2026), GPLv3 (with the Apache-2.0-licensed
upstream from Jack Palevich's
[Android-Terminal-Emulator](https://github.com/jackpal/Android-Terminal-Emulator)).

A thin `android.view.View` subclass that paints a `TerminalEmulator`'s
buffer onto a `Canvas` and converts touch/key input back into PTY writes.

## Phase 1 status

Vendored as-is so `:app` has the option to fall back to the legacy View
renderer if Compose proves too slow. **Compose UI takes over rendering in
a later phase**, at which point this module will likely shrink to just
input-handling helpers or be retired entirely. It's kept for now so:

- The Termux source tree we vendor stays complete and easy to refresh.
- The dependency graph is in place: `:app → :terminal-view → :terminal-emulator`.

## Build

```bash
android/gradlew :terminal-view:assembleDebug
```

`compileSdk = 35`, `minSdk = 30`, JDK 17. No unit tests live here yet —
the View requires Android UI plumbing, so behaviour testing happens via
the on-device path. The pure-JVM emulator state machine is exercised by
`:terminal-emulator`'s golden suite.
