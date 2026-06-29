# :terminal-emulator

Vendored from [`termux/termux-app`](https://github.com/termux/termux-app)
@ commit `401bbe54` (June 2026), under GPLv3. The original library is at
`terminal-emulator/`; we copy it as-is into
`src/main/java/com/termux/terminal/` so the upstream Termux history remains
diffable.

> Termux's `terminal-emulator` itself originated as a fork of
> [Android-Terminal-Emulator](https://github.com/jackpal/Android-Terminal-Emulator)
> (Apache 2.0). See [`LICENSE.md`](./LICENSE.md).

## What's used in Phase 1

- `com.termux.terminal.TerminalEmulator` — the pure-JVM screen state machine
  that consumes ANSI/VT byte streams and writes into a `TerminalBuffer`.
- `com.termux.terminal.TerminalBuffer` — packed text + per-cell styling.
- `com.termux.terminal.TextStyle` — bit layout for fg/bg color + effect bits.

## What's *not* used yet

- `com.termux.terminal.TerminalSession` and `JNI` (PTY allocation via
  `libtermux.so`). The NDK build is intentionally **disabled** in
  `build.gradle.kts`'s `sourceSets { main { jni.srcDirs() } }` so Phase 1's
  pure-JVM tests can run without NDK toolchains. A later phase will flip
  this back on when on-device terminals are wired up.
- `KeyHandler`, `WcWidth`, etc. — present in the vendored source for
  completeness; only loaded if/when a real session is constructed.

## Golden-fixture suite (`src/test/`)

The acceptance contract for this phase is that real-world recorded byte
streams round-trip through `TerminalEmulator` into snapshots that match
committed `.snap` files. The suite lives under
`src/test/java/com/dancode/terminalcore/`:

| File | Role |
|---|---|
| `EmulatorDriver.java` | Constructs an emulator with a no-op `TerminalOutput` + null `TerminalSessionClient`; feeds bytes; reads back per-row text. |
| `ScreenSnapshot.java` | Serializes the visible screen as a deterministic, human-diffable text format (text, fg color, bg color, effect — one line each per row). |
| `Fixtures.java` | Canonical byte streams for three fixtures (see below). |
| `RegenerateGoldens.java` | Atomically rewrites `src/test/resources/{fixtures,snapshots}/*` from canonical bytes. |
| `RegenerateGoldensTest.java` | JUnit wrapper for the regenerator — skipped unless `-Dregen.goldens=true`. |
| `GoldenFixturesTest.java` | The actual gates: per-fixture snapshot equality + alt-screen + mouse-tracking transitions. |

### Fixtures

| Name | Stream content | Asserted state |
|---|---|---|
| `colored-shell` | `ls --color=auto` style output: bold blue dir, bold green exec, plain file, bold red broken symlink, fresh `$` prompt. | Stays on **main** screen the whole time. Mouse off. |
| `vim-tui` | DECSET 1049 (alt-screen) → clear → `~` lines → inverse-video `-- INSERT --` status bar. | Alt-screen **active** at end of feed; toggles off after an explicit DECRST 1049 append. |
| `claude-altscreen` | Enters alt-screen + hides cursor + enables SGR mouse tracking (DECSET 1000/1006) → draws a Claude-style frame → exits (DECRST 1006/1000/1049). | At the mid-stream marker: alt **and** mouse tracking active. After full stream: both off; main screen restored. |

### Re-generating snapshots

```bash
android/gradlew :terminal-emulator:testDebugUnitTest \
    --tests com.dancode.terminalcore.RegenerateGoldensTest \
    -Dregen.goldens=true
```

The regenerator writes to `src/test/resources/{fixtures,snapshots}/`
atomically (`.tmp` → `mv`). A canonicity-check test
(`committedFixtureBytesMatchCanonicalBytes`) fails if any `.bin` on disk
drifts from `Fixtures.bytesFor(name)`, so silent rot is caught at the next
`gradlew test` run.

## Build + test

```bash
android/gradlew :terminal-emulator:test     # pure-JVM, no Android device
android/gradlew :app:assembleDebug          # transitively packages this lib
```

`compileSdk = 35`, `minSdk = 30`, JDK 17, Kotlin 1.9.24, AGP 8.7.3.
