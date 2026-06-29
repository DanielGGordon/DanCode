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

## After Phase 1 (proposed by Phase 1 generator)

- **NDK build for `:terminal-emulator` is intentionally disabled.** The
  vendored module sets `sourceSets { main { jni.srcDirs() } }` (empty),
  so `libtermux.so` is NOT compiled or packaged into the APK. This is
  fine for Phase 1 (the only consumer of the library so far is the
  golden-fixture test suite — pure Java, never touches `JNI.java` or
  `TerminalSession`). **The phase that wires up a real on-device
  terminal must:** (a) re-enable the `externalNativeBuild { ndkBuild { … } }`
  block from the Termux upstream `build.gradle`, (b) install the NDK
  via the bootstrap script (currently it pulls platforms + build-tools
  only), and (c) re-add `ndk { abiFilters … }` to the `defaultConfig`.
  See `/tmp/termux-app-vendor/terminal-emulator/build.gradle` (vendored
  reference) for the exact block.

- **Snapshot format is custom, not Yaml/JSON.** The `.snap` files use a
  4-line-per-row layout (text / fg / bg / effect) framed with `|…|` so
  diffs read like a screen, not a tree. If a later phase wants to share
  snapshots with the web client's xterm.js test suite consider switching
  to JSON or running both representations side-by-side — but the current
  format catches every cell-level regression and stays terse.

- **Effect glyphs only encode the first set bit.** `ScreenSnapshot`
  collapses combined effects (`bold | inverse`) to the first encountered
  flag letter. That's fine for current fixtures (no overlap) but if a
  later test needs to assert overlapping attributes (e.g. bold inverse
  highlight), extend `ScreenSnapshot.encodeEffect()` to render multiple
  glyphs (e.g. `[BV]`) or a packed hex code per cell.

- **Snapshot regeneration is an `Assume`-skipped test, not a separate
  Gradle task.** `gradlew :terminal-emulator:testDebugUnitTest --tests
  com.dancode.terminalcore.RegenerateGoldensTest -Dregen.goldens=true`
  is the canonical regen command — `Dregen.goldens` is forwarded to the
  test JVM via `testOptions.unitTests.all { systemProperty(...) }` in
  `build.gradle.kts`. A future phase that adds many more fixtures may
  want to promote this to a real Gradle `JavaExec` task instead.

- **Fixture screen is 40x8.** Tight on purpose so snapshots stay
  reviewable. Real-world Claude/vim TUIs run on much wider terminals;
  the emulator handles them identically but `Fixtures.COLS`/`ROWS` are
  the only knobs to change if a later phase needs to record at native
  size.

- **`committedFixtureBytesMatchCanonicalBytes` guards against rot.**
  Anyone editing `Fixtures.bytesFor()` without re-running the
  regenerator will see this test fail. Don't delete it — it's how we
  catch the silent class of bug where the code says "this is the
  recording" but the on-disk bytes have drifted.
