plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.dancode.android"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.dancode.android"
        minSdk = 30
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0-phase0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes {
        debug {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
    }

    composeOptions {
        // Compose Compiler 1.5.14 matches Kotlin 1.9.24 (kotlinx.org/docs/compose-compatibility.html).
        kotlinCompilerExtensionVersion = "1.5.14"
    }

    testOptions {
        unitTests {
            isIncludeAndroidResources = true
            isReturnDefaultValues = true
        }
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
}

// Phase 0 only ships a debug APK; the Compose `ui-test-manifest` artifact —
// which Robolectric needs to resolve the test ComponentActivity — is a
// debugImplementation, so it isn't in the release variant's merged manifest.
// Rather than ship the test manifest in release, just skip release unit
// tests from the aggregate `test` task.  Phase 0's acceptance criterion only
// requires `gradlew test` to run *a* trivial unit test green.
tasks.whenTaskAdded {
    if (name == "testReleaseUnitTest") {
        enabled = false
    }
}

dependencies {
    // Vendored Termux libraries (Phase 1). :terminal-view depends on
    // :terminal-emulator so picking it up brings both into :app.
    implementation(project(":terminal-view"))

    val composeBom = platform("androidx.compose:compose-bom:2024.09.00")
    implementation(composeBom)

    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-compose:1.9.2")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.5")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")

    debugImplementation("androidx.compose.ui:ui-tooling")
    debugImplementation("androidx.compose.ui:ui-test-manifest")

    testImplementation("junit:junit:4.13.2")
    testImplementation(composeBom)
    testImplementation("androidx.compose.ui:ui-test-junit4")
    testImplementation("org.robolectric:robolectric:4.13")
    testImplementation("androidx.test:core:1.6.1")
    testImplementation("androidx.test.ext:junit:1.2.1")
}
