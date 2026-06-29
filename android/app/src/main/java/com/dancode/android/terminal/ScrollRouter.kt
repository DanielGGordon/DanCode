package com.dancode.android.terminal

import kotlin.math.abs

/**
 * What the UI should do in response to a two-finger drag.
 *
 * The router is pure: it does not call into the transport or the
 * emulator view. The caller turns:
 *  - [SendBytes] into `connection.sendRaw(action.bytes)`
 *  - [LocalScroll] into a scroll on the underlying view (Termux's
 *    `TerminalView.onScroll` increments `mTopRow` etc.)
 *  - [None] into nothing
 */
sealed class ScrollAction {
    data class SendBytes(val bytes: String) : ScrollAction()
    data class LocalScroll(val deltaRows: Int) : ScrollAction()
    data object None : ScrollAction()
}

/**
 * Decides whether a two-finger drag turns into SGR mouse-wheel bytes or a
 * local scrollback adjustment.
 *
 * `deltaRows < 0` is interpreted as "drag up" — the user's fingers moved
 * upward, the content should move up. In raw mode that becomes a series
 * of wheel-up events; in local mode it nudges the scroll offset up by
 * `|delta|` lines.
 */
class ScrollRouter {

    fun onTwoFingerDrag(
        deltaRows: Int,
        cursorCol: Int,
        cursorRow: Int,
        state: EmulatorModeState,
    ): ScrollAction {
        if (deltaRows == 0) return ScrollAction.None
        val raw = state.altScreenActive || state.mouseTrackingActive
        if (!raw) return ScrollAction.LocalScroll(deltaRows = deltaRows)
        val count = abs(deltaRows)
        val one = if (deltaRows < 0)
            MouseWheelEncoder.wheelUp(col = cursorCol, row = cursorRow)
        else
            MouseWheelEncoder.wheelDown(col = cursorCol, row = cursorRow)
        val sb = StringBuilder(one.length * count)
        repeat(count) { sb.append(one) }
        return ScrollAction.SendBytes(sb.toString())
    }
}
