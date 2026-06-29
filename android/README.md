# android/ — DanCode native Android client

Native replacement for the mobile web client. Phase 0 is a Compose skeleton:
one screen, two trivial tests, and the build/test loop the agent uses for
every later phase.

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
├── settings.gradle.kts              Registers :app (more modules in Phase 1+)
├── build.gradle.kts                 Top-level plugins (AGP 8.5.2, Kotlin 1.9.24)
├── gradle.properties                AndroidX on, parallel + caching enabled
├── local.properties                 Generated — sdk.dir=<.toolchain/android-sdk>
└── app/
    ├── build.gradle.kts             Compose, minSdk 30, targetSdk 34
    └── src/
        ├── main/
        │   ├── AndroidManifest.xml
        │   ├── res/values/themes.xml
        │   └── java/com/dancode/android/
        │       ├── MainActivity.kt          ComponentActivity host
        │       └── ui/HomeScreen.kt         Phase-0 placeholder composable
        └── test/java/com/dancode/android/
            ├── SmokeTest.kt                 JUnit unit test (2+2=4)
            └── HomeScreenRenderTest.kt      Robolectric Compose render test
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
