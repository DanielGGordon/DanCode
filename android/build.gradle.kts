// Top-level build file — only declares plugins so subprojects can apply them.
// AGP 8.7.3 is the first 8.7.x stable release that officially supports
// compileSdk 35; it requires Gradle 8.9+ (we ship 8.9) and JDK 17.
plugins {
    id("com.android.application") version "8.7.3" apply false
    id("org.jetbrains.kotlin.android") version "1.9.24" apply false
}
