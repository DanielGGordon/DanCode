package com.dancode.android.terminal

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Two-finger scroll routing.
 *
 * The decision is keyed on the emulator state at the moment the gesture
 * fires:
 *  - alt-screen or mouse-tracking active → emit SGR (1006) wheel bytes so
 *    Claude/vim/less scrolls its own viewport
 *  - normal screen, no tracking → adjust the local scrollback offset so
 *    the user reviews lines the emulator already pushed off-screen
 *
 * The router has no side effects of its own: it returns a sealed
 * [ScrollAction] the caller turns into either a `sendInput` call (raw)
 * or a local view repaint (scrollback). This is the seam tested below.
 */
class ScrollRouterTest {

    private val ESC = ""

    @Test
    fun in_alt_screen_a_two_finger_drag_up_emits_wheel_up_bytes() {
        val router = ScrollRouter()
        val action = router.onTwoFingerDrag(
            deltaRows = -3,
            cursorCol = 10,
            cursorRow = 5,
            state = altOn(),
        )
        // 3 wheel-up events at the cursor position
        require(action is ScrollAction.SendBytes)
        val expected = ("$ESC[<64;10;5M").repeat(3)
        assertEquals(expected, action.bytes)
    }

    @Test
    fun in_alt_screen_a_two_finger_drag_down_emits_wheel_down_bytes() {
        val router = ScrollRouter()
        val action = router.onTwoFingerDrag(
            deltaRows = 2,
            cursorCol = 1,
            cursorRow = 1,
            state = altOn(),
        )
        require(action is ScrollAction.SendBytes)
        val expected = ("$ESC[<65;1;1M").repeat(2)
        assertEquals(expected, action.bytes)
    }

    @Test
    fun mouse_tracking_on_normal_screen_also_emits_wheel_bytes() {
        val router = ScrollRouter()
        val action = router.onTwoFingerDrag(
            deltaRows = -1,
            cursorCol = 4,
            cursorRow = 7,
            state = EmulatorModeState(altScreenActive = false, mouseTrackingActive = true),
        )
        require(action is ScrollAction.SendBytes)
        assertEquals("$ESC[<64;4;7M", action.bytes)
    }

    @Test
    fun normal_screen_a_drag_up_scrolls_local_buffer_up() {
        val router = ScrollRouter()
        val action = router.onTwoFingerDrag(
            deltaRows = -4,
            cursorCol = 1,
            cursorRow = 1,
            state = normal(),
        )
        assertEquals(ScrollAction.LocalScroll(deltaRows = -4), action)
    }

    @Test
    fun normal_screen_a_drag_down_scrolls_local_buffer_down() {
        val router = ScrollRouter()
        val action = router.onTwoFingerDrag(
            deltaRows = 5,
            cursorCol = 1,
            cursorRow = 1,
            state = normal(),
        )
        assertEquals(ScrollAction.LocalScroll(deltaRows = 5), action)
    }

    @Test
    fun zero_delta_returns_none() {
        val router = ScrollRouter()
        assertEquals(
            ScrollAction.None,
            router.onTwoFingerDrag(deltaRows = 0, cursorCol = 1, cursorRow = 1, state = altOn()),
        )
        assertEquals(
            ScrollAction.None,
            router.onTwoFingerDrag(deltaRows = 0, cursorCol = 1, cursorRow = 1, state = normal()),
        )
    }

    @Test
    fun routing_decision_is_keyed_on_the_state_passed_at_the_moment_of_the_gesture() {
        // Two gestures, one in alt and one in normal — the router has no
        // memory; both decisions are pure functions of the input state.
        val router = ScrollRouter()
        val a = router.onTwoFingerDrag(-1, 1, 1, altOn())
        val b = router.onTwoFingerDrag(-1, 1, 1, normal())
        assertTrue("first must be raw, got $a", a is ScrollAction.SendBytes)
        assertEquals(ScrollAction.LocalScroll(-1), b)
    }

    private fun altOn() = EmulatorModeState(altScreenActive = true, mouseTrackingActive = false)
    private fun normal() = EmulatorModeState(altScreenActive = false, mouseTrackingActive = false)
}
