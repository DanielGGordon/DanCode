// :terminal-emulator — vendored Termux terminal emulator (GPLv3).
//
// Source vendored from github.com/termux/termux-app @ 401bbe54 (June 2026).
// Pure JVM-friendly: TerminalEmulator + TerminalBuffer have no Android
// runtime deps that we exercise in tests. JNI / TerminalSession are kept
// for future on-device use but are not loaded by the JVM unit tests.

plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.termux.emulator"
    compileSdk = 35

    defaultConfig {
        minSdk = 30
        consumerProguardFiles("consumer-rules.pro")
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    // The vendored JNI (libtermux) is only needed to allocate real PTYs on a
    // device. Phase 1 only needs the pure-Java emulator on the JVM, so we
    // skip the NDK build entirely. Re-enable via a separate task in a later
    // phase when device-side PTY support is wired up.
    sourceSets {
        getByName("main") {
            jni.srcDirs()
        }
    }

    testOptions {
        unitTests {
            // The vendored TerminalEmulator imports android.util.Base64 for
            // OSC 52 clipboard handling. Our golden tests never feed OSC 52
            // sequences, so the import resolves at compile time (Android
            // stub jar) but is never executed at runtime.
            isReturnDefaultValues = true
            isIncludeAndroidResources = false
            all {
                // Forward the regen.goldens system property to the forked
                // test JVM so RegenerateGoldensTest can opt in. Gradle does
                // not propagate -D properties to test workers by default.
                it.systemProperty(
                    "regen.goldens",
                    System.getProperty("regen.goldens", "false")
                )
                it.testLogging {
                    events("passed", "failed", "skipped")
                }
            }
        }
    }
}

dependencies {
    implementation("androidx.annotation:annotation:1.9.0")
    testImplementation("junit:junit:4.13.2")
}
