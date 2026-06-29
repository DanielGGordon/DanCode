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
        │       └── projects/
        │           ├── Project.kt           name/slug/path record
        │           ├── ProjectsApi.kt       GET /api/projects (sealed ListResult)
        │           ├── DashboardController.kt  Loads + dispatches 401 to onUnauthorized
        │           └── DashboardScreen.kt   LazyColumn over project names
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
            └── projects/DashboardScreenTest.kt  Loading / Loaded / Error / Empty
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

## Why `testReleaseUnitTest` is disabled

The Compose `ui-test-manifest` artifact — which Robolectric needs to
resolve the test `ComponentActivity` — is a `debugImplementation`. Since
Phase 0 only ships a debug APK we'd rather skip the release-variant unit
test than embed the test manifest in a release artifact. See the
`tasks.whenTaskAdded` block in `app/build.gradle.kts`.
