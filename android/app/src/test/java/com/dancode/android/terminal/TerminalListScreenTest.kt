package com.dancode.android.terminal

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Acceptance criterion (paraphrased): "selecting a project lists its
 * terminals via GET /api/terminals?project=<slug>; selecting one opens a
 * full-screen terminal screen." The list rendering is exercised here;
 * the data-loader path is covered by [TerminalListControllerTest].
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class TerminalListScreenTest {

    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun renders_each_terminal_label_from_loaded_state() {
        composeRule.setContent {
            TerminalListScreen(
                state = TerminalListState.Loaded(
                    listOf(
                        TerminalSummary("t-1", "p", "CLI", "bash", "/"),
                        TerminalSummary("t-2", "p", "Claude", "claude", "/"),
                    ),
                ),
                onSelect = {},
            )
        }

        composeRule.onNodeWithTag(TerminalListScreenTags.LIST).assertIsDisplayed()
        composeRule.onNodeWithText("CLI").assertIsDisplayed()
        composeRule.onNodeWithText("Claude").assertIsDisplayed()
    }

    @Test
    fun renders_loading_indicator_in_loading_state() {
        composeRule.setContent {
            TerminalListScreen(state = TerminalListState.Loading, onSelect = {})
        }
        composeRule.onNodeWithTag(TerminalListScreenTags.LOADING).assertIsDisplayed()
    }

    @Test
    fun renders_empty_hint_when_no_terminals() {
        composeRule.setContent {
            TerminalListScreen(
                state = TerminalListState.Loaded(emptyList()),
                onSelect = {},
            )
        }
        composeRule.onNodeWithTag(TerminalListScreenTags.EMPTY).assertIsDisplayed()
    }

    @Test
    fun tapping_a_terminal_invokes_on_select_with_that_summary() {
        val terminals = listOf(
            TerminalSummary("t-1", "p", "CLI", "bash", "/"),
            TerminalSummary("t-2", "p", "Claude", "claude", "/"),
        )
        var selected: TerminalSummary? = null
        composeRule.setContent {
            TerminalListScreen(
                state = TerminalListState.Loaded(terminals),
                onSelect = { selected = it },
            )
        }

        composeRule.onNodeWithTag(TerminalListScreenTags.ITEM_PREFIX + "t-2").performClick()

        assertEquals(terminals[1], selected)
    }
}
