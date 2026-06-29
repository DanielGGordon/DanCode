package com.dancode.android

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Tracer-bullet test that proves the JVM unit-test path is wired up.
 * If this stops passing, the Gradle test task itself is broken.
 */
class SmokeTest {
    @Test
    fun arithmetic_is_still_arithmetic() {
        assertEquals(4, 2 + 2)
    }
}
