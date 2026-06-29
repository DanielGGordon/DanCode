package com.dancode.android.terminal

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * SGR (1006) extended mouse-wheel encoding.
 *
 * Wheel events are reported as `CSI < Cb ; Cx ; Cy M`. Button codes 64 / 65
 * are the wheel-up / wheel-down extensions used by xterm and consumed by
 * Claude Code. Coordinates are 1-based per spec.
 *
 * The encoder rejects coordinates < 1 by clamping to 1, mirroring xterm —
 * a (0,0) gesture must still produce a valid sequence the receiver can
 * parse.
 */
class MouseWheelEncoderTest {

    private val ESC = ""

    @Test
    fun wheel_up_at_1_1_uses_button_64_with_trailing_M() {
        assertEquals("$ESC[<64;1;1M", MouseWheelEncoder.wheelUp(col = 1, row = 1))
    }

    @Test
    fun wheel_down_at_1_1_uses_button_65_with_trailing_M() {
        assertEquals("$ESC[<65;1;1M", MouseWheelEncoder.wheelDown(col = 1, row = 1))
    }

    @Test
    fun arbitrary_coordinates_are_passed_through_verbatim() {
        assertEquals("$ESC[<64;42;7M", MouseWheelEncoder.wheelUp(col = 42, row = 7))
        assertEquals("$ESC[<65;80;24M", MouseWheelEncoder.wheelDown(col = 80, row = 24))
    }

    @Test
    fun zero_or_negative_coordinates_clamp_to_one() {
        assertEquals("$ESC[<64;1;1M", MouseWheelEncoder.wheelUp(col = 0, row = 0))
        assertEquals("$ESC[<65;1;1M", MouseWheelEncoder.wheelDown(col = -3, row = -1))
    }
}
