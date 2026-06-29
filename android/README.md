# android/ — DanCode native Android client

Native replacement for the mobile web client.

- **Phase 0** — Compose skeleton: one screen, two trivial tests, and the
  toolchain bootstrap that every later phase reuses.
- **Phase 1** — Vendored Termux `:terminal-emulator` + `:terminal-view`
  modules wired into `:app`, plus a pure-JVM golden-test suite under
  `:terminal-emulator` that drives recorded byte streams through the
  emulator and asserts screen-buffer snapshots, alt-screen and
  mouse-tracking transitions. See
  [`terminal-emulator/README.md`](./terminal-emulator/README.md).
- **Phase 2** — TLS-pinned networking, a TOTP-based login flow that
  persists the auth token in `EncryptedSharedPreferences`, and a
  dashboard listing the user's projects from `GET /api/projects`, served
  through a server-side Caddy TLS terminator (`reverse-proxy/`).
- **Phase 3** — Tap a project → tap a terminal → full-screen live PTY.
  Output streams over Socket.io to a Termux-backed `TerminalView`;
  reconnects clear the screen before the ring-buffer replay so nothing
  duplicates; a "reconnecting" overlay covers transient drops. Input is
  cooked-mode: the bottom Compose field sends the typed line plus `\r`.
  Resizes derived from view metrics fire on attach and on every layout
  change.
- **Phase 4** — Claude Code on a phone. A 9-key control bar surfaces the
  keys Claude needs that aren't on a phone soft-keyboard (Esc, four
  arrows, Enter, Ctrl+C, Tab, Shift+Tab) with golden tests pinning each
  byte sequence. The input mode auto-flips to raw passthrough when the
  emulator enters alt-screen / mouse-tracking and back to cooked when it
  exits; a header toggle cycles Auto → Cooked → Raw for manual override.
  Two-finger vertical drags inside the alt-screen emit SGR (1006)
  mouse-wheel bytes so Claude scrolls its own viewport; outside it the
  same gesture falls through to the local scrollback buffer. The mode
  transition is end-to-end golden-tested with a recorded DECSET 1049 /
  1006 / 1000 stream.
- **Phase 5** — Navigation & polish. Three-level navigation
  (`dashboard → terminal list → terminal`) with a back affordance at
  every level (dashboard's is Sign-out). Inside a project,
  `TerminalSwiper` wraps the terminal in a `HorizontalPager` so a
  left/right swipe cycles between the project's sibling terminals.
  Font size is adjustable from a header A-/A/A+ row AND a pinch gesture
  (a `PinchZoomDetector` accumulates per-frame scale until a 1.20× /
  0.83× threshold trips). Sizes persist per terminal id through a
  `TerminalFontSizeStore` backed by `SharedPreferences`. Rotation +
  soft-keyboard show/hide no longer recreate the activity — the
  manifest declares `configChanges` for orientation, screen size,
  screen layout, smallest screen size and keyboard, with
  `windowSoftInputMode=adjustResize` so the embedded `TerminalView`
  re-lays-out and emits a fresh resize. Token expiry routes back to
  login but `AppNavController` stashes the in-progress screen as
  *pending* and resumes there after a successful re-login; manual
  Sign-out wipes the pending destination on purpose. Error states on
  the dashboard and terminal list render a Retry button instead of
  hanging, and a 401 still triggers the same `onUnauthorized` callback.

## One-time setup

```bash
bash android/scripts/bootstrap-toolchain.sh
```

The script installs a project-local **JDK 17** (Temurin 17.0.12+7) and the
**Android SDK** (cmdline-tools, platform-tools, platforms;android-35,
build-tools;35.0.0) under `android/.toolchain/`. Nothing outside that
directory is touched — the system `java` install (1.8 on the Hetzner box)
keeps reporting 1.8 after the script finishes. SDK licenses are accepted
non-interactively. The script is idempotent: re-running it just verifies
what's already on disk.

## Build + test

```bash
android/gradlew :app:assembleDebug   # debug-signed APK
android/gradlew test                 # headless unit tests
```

`android/gradlew` is the standard Gradle wrapper with a tiny header that
sources `.toolchain/env.sh` and chdirs into `android/`, so every invocation
gets JDK 17 + the project-local Android SDK without changing the caller's
environment and works from any working directory (no `-p android` needed).

Outputs:

- APK → `android/app/build/outputs/apk/debug/app-debug.apk` (debug-signed)
- Unit test results → `android/app/build/reports/tests/testDebugUnitTest/`

## Layout

```
android/
├── scripts/bootstrap-toolchain.sh   Provision JDK 17 + Android SDK locally
├── .toolchain/                      Bootstrapped JDK + SDK (gitignored)
├── gradlew                          Wrapper, sources .toolchain/env.sh
├── gradle/wrapper/                  Standard Gradle 8.9 wrapper jar + props
├── settings.gradle.kts              Registers :app, :terminal-emulator, :terminal-view
├── terminal-emulator/               Phase 1: vendored Termux emulator (GPLv3) + golden tests
├── terminal-view/                   Phase 1: vendored Termux View (GPLv3)
├── build.gradle.kts                 Top-level plugins (AGP 8.7.3, Kotlin 1.9.24)
├── gradle.properties                AndroidX on, parallel + caching enabled
├── local.properties                 Generated — sdk.dir=<.toolchain/android-sdk>
├── reverse-proxy/                   Phase 2: Caddy config + self-signed
│   │                                cert + APK download route (server-side)
│   ├── Caddyfile                    https://5.78.231.51:8443 → 127.0.0.1:3000
│   ├── install.sh                   Copy cert + symlink config into /etc/caddy
│   ├── README.md                    One-time setup + rebuild flow
│   ├── certs/server.crt             Self-signed cert (committed for pin reproducibility)
│   └── scripts/
│       ├── generate-cert.sh         Mint self-signed cert with SAN=IP:5.78.231.51
│       ├── sync-pin.sh              Copy cert to raw/, update NSC pin in app
│       └── publish-apk.sh           Build :app:assembleDebug, copy → /var/lib/dancode-apk/
└── app/
    ├── build.gradle.kts             Compose, minSdk 30, targetSdk 35
    └── src/
        ├── main/
        │   ├── AndroidManifest.xml          INTERNET + networkSecurityConfig
        │   ├── res/raw/dancode_server.crt   Pinned trust anchor (Phase 2)
        │   ├── res/values/themes.xml
        │   ├── res/xml/network_security_config.xml  Pins SPKI hash to 5.78.231.51
        │   └── java/com/dancode/android/
        │       ├── MainActivity.kt          ComponentActivity hosting AppNav
        │       ├── auth/
        │       │   ├── TokenStorage.kt      EncryptedSharedPreferences wrapper
        │       │   ├── AuthApi.kt           POST /api/auth/login (OkHttp)
        │       │   ├── LoginController.kt   Form state + submit + token persist
        │       │   └── LoginScreen.kt       Compose form (URL + user + pw + TOTP)
        │       ├── net/
        │       │   └── BearerAuthInterceptor.kt  Injects Authorization: Bearer
        │       ├── projects/
        │       │   ├── Project.kt           name/slug/path record
        │       │   ├── ProjectsApi.kt       GET /api/projects (sealed ListResult)
        │       │   ├── DashboardController.kt  Loads + dispatches 401 to onUnauthorized
        │       │   └── DashboardScreen.kt   LazyColumn over project names; onSelect → terminal list
        │       └── terminal/                Phase 3+4: live terminal slice
        │           ├── TerminalSummary.kt           id/projectSlug/label/command/cwd
        │           ├── TerminalsApi.kt              GET /api/terminals?project=<slug>
        │           ├── TerminalListController.kt    Loading lifecycle + 401 routing
        │           ├── TerminalListScreen.kt        LazyColumn over terminals; onSelect → terminal
        │           ├── TerminalInputEncoder.kt      cooked-mode: line + "\r"
        │           ├── ControlKey.kt                Phase 4: enum + golden byte sequences (Esc/arrows/Enter/Ctrl+C/Tab/Shift+Tab)
        │           ├── InputModePolicy.kt           Phase 4: Cooked↔Raw auto-switch + manual override
        │           ├── MouseWheelEncoder.kt         Phase 4: SGR (1006) wheel-up/down encoder
        │           ├── ScrollRouter.kt              Phase 4: two-finger drag → SGR bytes or LocalScroll
        │           ├── TerminalViewMetrics.kt       cols/rows from view px + cell px
        │           ├── TerminalTransport.kt         Transport + listener + sink interfaces
        │           ├── TerminalConnection.kt        Idle→Connecting→Connected→Reconnecting; clears sink on reconnect; Phase 4: sendRaw()
        │           ├── SocketIoTransport.kt         Production transport (io.socket:socket.io-client)
        │           ├── TerminalEmulatorSink.kt      Writes/clears the Termux emulator
        │           ├── TerminalScreen.kt            Compose: header + view slot + key bar + override toggle + input + overlay
        │           └── TerminalHost.kt              Wires transport+session+sink+connection to TerminalView; polls emulator state for mode policy; pointerInput → ScrollRouter
        ├── java/com/termux/terminal/
        │   └── RemoteTerminalSession.kt    TerminalSession that never opens a JNI PTY
        └── test/java/com/dancode/android/
            ├── SmokeTest.kt                 JUnit unit test (2+2=4)
            ├── auth/TokenStorageTest.kt        Robolectric round-trip
            ├── auth/AuthApiTest.kt             MockWebServer + Robolectric
            ├── auth/LoginControllerTest.kt     Persist + onLoggedIn + error paths
            ├── auth/LoginScreenRenderTest.kt   Compose render + typing
            ├── net/BearerAuthInterceptorTest.kt MockWebServer header assertion
            ├── net/NetworkSecurityConfigTest.kt XML pin scoped to 5.78.231.51
            ├── projects/ProjectsApiTest.kt     MockWebServer Bearer + parse + 401
            ├── projects/DashboardControllerTest.kt  401 → onUnauthorized fires
            ├── projects/DashboardScreenTest.kt  Loading / Loaded / Error / Empty / onSelect
            └── terminal/
                ├── TerminalInputEncoderTest.kt   line + "\r" encoding edge cases
                ├── TerminalViewMetricsTest.kt    floor; min-one-by-one; font scale
                ├── TerminalsApiTest.kt           MockWebServer Bearer + parse + 401
                ├── TerminalListControllerTest.kt Loading/Loaded/Error; 401 routing
                ├── TerminalListScreenTest.kt     Loading/Loaded/Error/Empty + onSelect
                ├── TerminalScreenTest.kt         Overlay on Reconnecting; Send forwards line; key bar; override toggle
                ├── TerminalConnectionTest.kt     State machine + reconnect-dedup + buffered resize; sendRaw
                ├── SocketIoTransportOptionsTest.kt  IO.Options: WS-only, auth.token, OkHttp factory
                ├── RemoteTerminalSessionTest.kt  initializeEmulator without JNI; write forwards
                ├── TerminalEmulatorSinkTest.kt   reset clears screen before next replay
                ├── ControlKeyTest.kt             Phase 4: golden byte sequence per ControlKey
                ├── InputModePolicyTest.kt        Phase 4: auto-switch + manual override semantics
                ├── MouseWheelEncoderTest.kt      Phase 4: SGR (1006) encoder, coord clamping
                ├── ScrollRouterTest.kt           Phase 4: SGR vs local scroll decision
                └── AltScreenRawModeTransitionTest.kt  Phase 4: real-emulator DECSET 1049/1006/1000 timeline → InputMode timeline
```

## Versions

| Component         | Pinned at                          |
|-------------------|------------------------------------|
| JDK               | Temurin 17.0.12+7                  |
| Gradle            | 8.9                                |
| Android Gradle Plugin | 8.7.3                          |
| Kotlin            | 1.9.24                             |
| Compose Compiler  | 1.5.14                             |
| Compose BOM       | 2024.09.00                         |
| Android SDK       | platforms;android-35, build-tools;35.0.0 |
| `minSdk`          | 30                                 |
| `targetSdk`       | 35                                 |
| `applicationId`   | `com.dancode.android`              |

## Manual smoke (Phase 3, not gated)

The gated `android/gradlew test` run uses no device, no network, no live
backend. The on-phone path is exercised by hand as part of each Phase 3
release smoke:

1. Build a fresh debug APK: `android/gradlew :app:assembleDebug`.
2. Sideload from the phone browser via the APK download route on the
   pinned-TLS endpoint.
3. Open the app, log in with username/password/TOTP.
4. Tap any project → the project's terminals appear.
5. Tap a shell terminal → the full-screen view opens and prints the
   shell's prompt (the server's ring-buffer replay).
6. In the Send field type `ls` and press Send — file listing should
   appear in the view.
7. Drop the network (airplane mode or unplug Wi-Fi) — the
   "Reconnecting…" overlay must surface.
8. Restore the network — the overlay clears, the screen resets cleanly
   (no doubled prompt or duplicated `ls` output), and live output keeps
   streaming.

## Manual smoke (Phase 4, not gated)

Phase 4 adds the headline capability — drive a full Claude Code session
on the phone. Run on a real device after the Phase 3 smoke passes:

1. Open the Claude terminal in any project. The Send field works in
   cooked mode until Claude redraws the screen.
2. Type `claude` and Send. Once the alt-screen takes over, the header
   mode badge should flip from `Auto` (resolved Cooked) to a resolved
   Raw mode automatically — the Send field below greys out.
3. Tap each key in the bar: `Esc`, `↑ ↓ ← →`, `Enter`, `Ctrl+C`, `Tab`,
   `Shift+Tab` — the menu / prompt should respond as if you typed each.
4. Two-finger drag inside Claude's view: the viewport should scroll,
   not the local terminal scrollback.
5. Force the override: tap the header toggle to `Cooked`. The Send
   field re-enables even while Claude is on the alt-screen. Tap again
   to land on `Raw`, then once more to return to `Auto`.
6. Open a session previously started in the web client (use Resume on
   the web first, then close the browser; in the app, attach to that
   terminal). The shellhost-backed PTY reflows on resize — the screen
   should render the existing session intact.

## Why `testReleaseUnitTest` is disabled

The Compose `ui-test-manifest` artifact — which Robolectric needs to
resolve the test `ComponentActivity` — is a `debugImplementation`. Since
Phase 0 only ships a debug APK we'd rather skip the release-variant unit
test than embed the test manifest in a release artifact. See the
`tasks.whenTaskAdded` block in `app/build.gradle.kts`.
