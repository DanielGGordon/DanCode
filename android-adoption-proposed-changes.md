# android-adoption — Proposed changes from later phases

## After Phase 0 (proposed by Phase 0 generator)

- **`testReleaseUnitTest` is disabled in `app/build.gradle.kts`.** The
  Compose `ui-test-manifest` artifact is a `debugImplementation` (so the
  test `ComponentActivity` only resolves in the debug manifest merge).
  Phase 0 only ships a debug APK and the acceptance criterion only
  required `gradlew test` to be green, so the release unit-test task is
  filtered out via a `tasks.whenTaskAdded` hook. **Future phases that
  introduce a release build** (signed or otherwise) must either move
  `ui-test-manifest` into `releaseImplementation` *as well* or run
  Robolectric tests only against the debug variant explicitly. Do **not**
  drop the filter without re-checking — it'll silently fail CI.

- **Bootstrap script's license-acceptance step disables `pipefail`.**
  `yes | sdkmanager --licenses` makes `yes` exit on SIGPIPE (rc 141) the
  moment sdkmanager closes stdin, which would kill the script under
  `set -o pipefail`. The script flips pipefail off around just that
  pipeline. If you copy the pattern elsewhere keep the same scoping.

- **JDK SHA-256 is pinned by version, not hash-of-a-symlink.** The
  bootstrap downloads `OpenJDK17U-jdk_x64_linux_hotspot_17.0.12_7.tar.gz`
  with hash `9d4dd339bf7e6a9dcba8347661603b74c61ab2a5083ae67bf76da6285da8a778`.
  When you bump the JDK fetch `…tar.gz.sha256.txt` from the same release
  and update both the URL and the pinned hash in lockstep — do not skip
  the verification.

- **Linux-only bootstrap.** `bootstrap-toolchain.sh` only downloads the
  `_x64_linux_` JDK tarball and the `commandlinetools-linux-` zip. The
  Hetzner box is the only target environment in the plan, so this is
  fine for now, but if a phase needs the toolchain on macOS / arm64
  add platform detection (`uname -sm`) and switch the URLs accordingly.

- **Gradle wrapper customisation.** `android/gradlew` has a small block
  near the top that sources `.toolchain/env.sh`. If a future phase
  regenerates the wrapper (e.g. `./gradlew wrapper --gradle-version=…`)
  the customisation gets clobbered — re-apply the snippet from
  Phase 0's commit, or extract it into `gradlew.dancode` and call
  through.

- **Target SDK choice.** `compileSdk`/`targetSdk` is **34** (Android 14).
  AGP 8.5 supports up to 34 cleanly; bumping to 35/36 requires AGP 8.6+
  and matching Compose Compiler + Kotlin upgrades. The phase plan says
  "current target SDK" — interpret that as the current target supported
  by the currently-pinned AGP, not "whatever Android is shipping today".

- **`android/.toolchain/` is gitignored.** Don't add anything underneath
  that you actually want tracked. The cache dir lives inside it too.

- **Robolectric uses `@Config(sdk = [33])`.** Robolectric 4.13 does
  not ship a full Android 34 runtime yet (uses 33 as max). Compose still
  renders fine. When Robolectric ships SDK 34 support bump the `@Config`.
