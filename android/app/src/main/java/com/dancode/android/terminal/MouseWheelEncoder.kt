package com.dancode.android.terminal

/**
 * SGR (1006) mouse-wheel encoder.
 *
 * Two-finger drags inside the alt-screen / mouse-tracking state are
 * translated into these sequences so TUIs scroll their own viewport
 * instead of the local scrollback. Reporting format: `CSI < Cb ; Cx ; Cy M`.
 *
 * Button codes:
 *  - 64 = wheel up
 *  - 65 = wheel down
 *
 * Coordinates are 1-based per spec. Out-of-range values (a drag landing
 * before the renderer has computed its grid origin) clamp to 1 so the
 * receiver always sees a parseable sequence.
 */
object MouseWheelEncoder {

    private const val ESC = ""
    private const val BUTTON_WHEEL_UP = 64
    private const val BUTTON_WHEEL_DOWN = 65

    fun wheelUp(col: Int, row: Int): String = encode(BUTTON_WHEEL_UP, col, row)

    fun wheelDown(col: Int, row: Int): String = encode(BUTTON_WHEEL_DOWN, col, row)

    private fun encode(button: Int, col: Int, row: Int): String {
        val c = if (col < 1) 1 else col
        val r = if (row < 1) 1 else row
        return "$ESC[<$button;$c;${r}M"
    }
}
