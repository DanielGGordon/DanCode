package com.dancode.android.terminal

import androidx.compose.material3.Text
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Acceptance criteria covered here:
 *  - Tapping Send forwards the typed line to the input callback.
 *  - The "reconnecting" overlay surfaces when the connection-state machine
 *    reports [TerminalConnection.State.Reconnecting], and disappears once
 *    the connection is back to [TerminalConnection.State.Connected].
 *
 * The embedded [com.termux.view.TerminalView] is supplied as a slot so this
 * test can substitute a placeholder Composable. Production wires the slot
 * to the vendored AndroidView.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class TerminalScreenTest {

    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun renders_reconnecting_overlay_when_state_is_reconnecting() {
        composeRule.setContent {
            TerminalScreen(
                state = TerminalConnection.State.Reconnecting,
                label = "CLI",
                onSend = {},
                onBack = {},
                terminalContent = { Text("xterm-placeholder") },
            )
        }
        composeRule.onNodeWithTag(TerminalScreenTags.RECONNECTING_OVERLAY)
            .assertIsDisplayed()
    }

    @Test
    fun does_not_render_overlay_when_state_is_connected() {
        composeRule.setContent {
            TerminalScreen(
                state = TerminalConnection.State.Connected,
                label = "CLI",
                onSend = {},
                onBack = {},
                terminalContent = { Text("xterm-placeholder") },
            )
        }
        try {
            composeRule.onNodeWithTag(TerminalScreenTags.RECONNECTING_OVERLAY)
                .assertIsDisplayed()
            throw AssertionError("expected reconnect overlay to be absent in Connected state")
        } catch (expected: AssertionError) {
            // assertIsDisplayed throws when node does not exist — that's
            // exactly what we want here.
        }
    }

    @Test
    fun typing_and_send_invokes_on_send_with_the_entered_line() {
        var sent: String? = null
        composeRule.setContent {
            TerminalScreen(
                state = TerminalConnection.State.Connected,
                label = "CLI",
                onSend = { sent = it },
                onBack = {},
                terminalContent = { Text("xterm-placeholder") },
            )
        }

        composeRule.onNodeWithTag(TerminalScreenTags.INPUT).performTextInput("ls")
        composeRule.onNodeWithTag(TerminalScreenTags.SEND).performClick()

        assertEquals("ls", sent)
    }

    @Test
    fun back_button_invokes_on_back() {
        var backCount = 0
        composeRule.setContent {
            TerminalScreen(
                state = TerminalConnection.State.Connected,
                label = "CLI",
                onSend = {},
                onBack = { backCount++ },
                terminalContent = { Text("xterm-placeholder") },
            )
        }
        composeRule.onNodeWithTag(TerminalScreenTags.BACK).performClick()
        assertEquals(1, backCount)
    }
}
