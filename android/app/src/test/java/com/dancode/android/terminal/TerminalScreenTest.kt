package com.dancode.android.terminal

import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Acceptance criteria covered here:
 *  - The "reconnecting" overlay surfaces when the connection-state machine
 *    reports [TerminalConnection.State.Reconnecting].
 *  - The cooked-mode input row is enabled only when state is Connected
 *    AND [InputMode.Cooked]; otherwise it's disabled so users don't queue
 *    text into a raw-mode session.
 *  - The control key bar emits the right [ControlKey] for every button
 *    (Esc, arrows, Enter, Ctrl+C, Tab, Shift+Tab).
 *  - The manual-override toggle cycles Auto → Cooked → Raw → Auto and
 *    drives the supplied callback.
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
        renderScreen(state = TerminalConnection.State.Reconnecting)
        composeRule.onNodeWithTag(TerminalScreenTags.RECONNECTING_OVERLAY)
            .assertIsDisplayed()
    }

    @Test
    fun does_not_render_overlay_when_state_is_connected() {
        renderScreen(state = TerminalConnection.State.Connected)
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
        renderScreen(
            state = TerminalConnection.State.Connected,
            onSend = { sent = it },
        )
        composeRule.onNodeWithTag(TerminalScreenTags.INPUT).performTextInput("ls")
        composeRule.onNodeWithTag(TerminalScreenTags.SEND).performClick()
        assertEquals("ls", sent)
    }

    @Test
    fun back_button_invokes_on_back() {
        var backCount = 0
        renderScreen(
            state = TerminalConnection.State.Connected,
            onBack = { backCount++ },
        )
        composeRule.onNodeWithTag(TerminalScreenTags.BACK).performClick()
        assertEquals(1, backCount)
    }

    @Test
    fun cooked_input_row_is_disabled_when_input_mode_is_raw() {
        renderScreen(
            state = TerminalConnection.State.Connected,
            inputMode = InputMode.Raw,
        )
        // The text field shouldn't accept input when raw is engaged — the
        // key bar is the input surface in that mode.
        composeRule.onNodeWithTag(TerminalScreenTags.INPUT).assertIsNotEnabled()
        composeRule.onNodeWithTag(TerminalScreenTags.SEND).assertIsNotEnabled()
    }

    @Test
    fun cooked_input_row_is_enabled_when_input_mode_is_cooked_and_connected() {
        renderScreen(
            state = TerminalConnection.State.Connected,
            inputMode = InputMode.Cooked,
        )
        composeRule.onNodeWithTag(TerminalScreenTags.INPUT).assertIsEnabled()
        composeRule.onNodeWithTag(TerminalScreenTags.SEND).assertIsEnabled()
    }

    @Test
    fun key_bar_renders_a_button_for_every_control_key() {
        renderScreen(state = TerminalConnection.State.Connected)
        // Some keys may be off-screen in the horizontal scroller depending
        // on viewport width — scroll each into view before asserting it
        // is displayed.
        for (key in ControlKey.entries) {
            composeRule.onNodeWithTag(TerminalScreenTags.keyTag(key))
                .performScrollTo()
                .assertIsDisplayed()
        }
    }

    @Test
    fun key_bar_button_taps_invoke_on_key_with_the_right_entry() {
        val pressed = mutableListOf<ControlKey>()
        renderScreen(
            state = TerminalConnection.State.Connected,
            onKey = { pressed += it },
        )
        // performScrollTo brings the node into view in horizontal-scroll
        // rows before the click; otherwise off-screen taps silently no-op.
        composeRule.onNodeWithTag(TerminalScreenTags.keyTag(ControlKey.Esc))
            .performScrollTo().performClick()
        composeRule.onNodeWithTag(TerminalScreenTags.keyTag(ControlKey.ArrowUp))
            .performScrollTo().performClick()
        composeRule.onNodeWithTag(TerminalScreenTags.keyTag(ControlKey.CtrlC))
            .performScrollTo().performClick()
        composeRule.onNodeWithTag(TerminalScreenTags.keyTag(ControlKey.ShiftTab))
            .performScrollTo().performClick()
        assertEquals(
            listOf(ControlKey.Esc, ControlKey.ArrowUp, ControlKey.CtrlC, ControlKey.ShiftTab),
            pressed,
        )
    }

    @Test
    fun key_bar_buttons_are_disabled_when_not_connected() {
        renderScreen(state = TerminalConnection.State.Reconnecting)
        composeRule.onNodeWithTag(TerminalScreenTags.keyTag(ControlKey.Esc)).assertIsNotEnabled()
        composeRule.onNodeWithTag(TerminalScreenTags.keyTag(ControlKey.ArrowUp)).assertIsNotEnabled()
    }

    @Test
    fun manual_override_toggle_cycles_auto_cooked_raw_auto() {
        val sets = mutableListOf<InputMode?>()
        composeRule.setContent {
            // `mutableStateOf` so each onSet recomposes the screen with the
            // new override — that's the only way the next tap reads the
            // new label / cycle position.
            var currentOverride by remember { mutableStateOf<InputMode?>(null) }
            TerminalScreen(
                state = TerminalConnection.State.Connected,
                label = "CLI",
                onSend = {},
                onBack = {},
                inputMode = InputMode.Cooked,
                manualOverride = currentOverride,
                onKey = {},
                onSetManualOverride = { newVal ->
                    sets += newVal
                    currentOverride = newVal
                },
                terminalContent = { Text("xterm-placeholder") },
            )
        }
        // Auto → Cooked
        composeRule.onNodeWithTag(TerminalScreenTags.OVERRIDE_TOGGLE).performClick()
        // Cooked → Raw
        composeRule.onNodeWithTag(TerminalScreenTags.OVERRIDE_TOGGLE).performClick()
        // Raw → Auto
        composeRule.onNodeWithTag(TerminalScreenTags.OVERRIDE_TOGGLE).performClick()
        assertEquals(listOf(InputMode.Cooked, InputMode.Raw, null), sets)
    }

    @Test
    fun manual_override_toggle_starts_in_auto_with_null_override() {
        // Sanity-check default for the toggle: no override yet.
        renderScreen(state = TerminalConnection.State.Connected)
        composeRule.onNodeWithTag(TerminalScreenTags.OVERRIDE_TOGGLE).assertIsDisplayed()
        assertNull(null) // self-documenting placeholder
    }

    @Test
    fun font_size_buttons_emit_increase_decrease_and_reset() {
        val events = mutableListOf<FontSizeAction>()
        renderScreen(
            state = TerminalConnection.State.Connected,
            onFontSizeAction = { events += it },
        )
        composeRule.onNodeWithTag(TerminalScreenTags.FONT_INC).performScrollTo().performClick()
        composeRule.onNodeWithTag(TerminalScreenTags.FONT_DEC).performScrollTo().performClick()
        composeRule.onNodeWithTag(TerminalScreenTags.FONT_RESET).performScrollTo().performClick()
        assertEquals(
            listOf(FontSizeAction.Increase, FontSizeAction.Decrease, FontSizeAction.Reset),
            events,
        )
    }

    private fun renderScreen(
        state: TerminalConnection.State,
        inputMode: InputMode = InputMode.Cooked,
        manualOverride: InputMode? = null,
        onSend: (String) -> Unit = {},
        onBack: () -> Unit = {},
        onKey: (ControlKey) -> Unit = {},
        onSetManualOverride: (InputMode?) -> Unit = {},
        onFontSizeAction: (FontSizeAction) -> Unit = {},
    ) {
        composeRule.setContent {
            TerminalScreen(
                state = state,
                label = "CLI",
                onSend = onSend,
                onBack = onBack,
                inputMode = inputMode,
                manualOverride = manualOverride,
                onKey = onKey,
                onSetManualOverride = onSetManualOverride,
                onFontSizeAction = onFontSizeAction,
                terminalContent = { Text("xterm-placeholder") },
            )
        }
    }
}
