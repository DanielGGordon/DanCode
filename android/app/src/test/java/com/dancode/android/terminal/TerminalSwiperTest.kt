package com.dancode.android.terminal

import androidx.compose.material3.Text
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeLeft
import androidx.compose.ui.test.swipeRight
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Acceptance criterion 1, second clause: "swiping left/right cycles
 * between a project's terminals." The Swiper is a HorizontalPager-backed
 * Composable that owns the swipe gesture and renders the caller's
 * per-page slot for the visible terminal. The slot lets tests substitute a
 * lightweight placeholder for the live [TerminalHost].
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class TerminalSwiperTest {

    @get:Rule
    val composeRule = createComposeRule()

    private val terminals = listOf(
        TerminalSummary("t-1", "p", "CLI", "bash", "/"),
        TerminalSummary("t-2", "p", "Claude", "claude", "/"),
        TerminalSummary("t-3", "p", "Logs", "tail", "/"),
    )

    @Test
    fun renders_initial_terminal_at_initial_index() {
        composeRule.setContent {
            TerminalSwiper(
                terminals = terminals,
                initialIndex = 1,
                page = { terminal ->
                    Text(text = "id=${terminal.id}", modifier = Modifier.testTag("page-${terminal.id}"))
                },
            )
        }
        composeRule.onNodeWithTag("page-t-2").assertIsDisplayed()
    }

    @Test
    fun swipe_left_advances_to_next_terminal() {
        composeRule.setContent {
            TerminalSwiper(
                terminals = terminals,
                initialIndex = 0,
                page = { terminal ->
                    Text(text = "id=${terminal.id}", modifier = Modifier.testTag("page-${terminal.id}"))
                },
            )
        }
        composeRule.onNodeWithTag("page-t-1").assertIsDisplayed()
        composeRule.onNodeWithTag(TerminalSwiperTags.PAGER).performTouchInput { swipeLeft() }
        composeRule.waitForIdle()
        composeRule.onNodeWithTag("page-t-2").assertIsDisplayed()
    }

    @Test
    fun swipe_right_returns_to_previous_terminal() {
        composeRule.setContent {
            TerminalSwiper(
                terminals = terminals,
                initialIndex = 2,
                page = { terminal ->
                    Text(text = "id=${terminal.id}", modifier = Modifier.testTag("page-${terminal.id}"))
                },
            )
        }
        composeRule.onNodeWithTag("page-t-3").assertIsDisplayed()
        composeRule.onNodeWithTag(TerminalSwiperTags.PAGER).performTouchInput { swipeRight() }
        composeRule.waitForIdle()
        composeRule.onNodeWithTag("page-t-2").assertIsDisplayed()
    }

    @Test
    fun single_terminal_in_project_renders_without_failure() {
        // Don't crash with a 1-item pager — a project may have only one
        // terminal and there's nowhere to swipe.
        val one = listOf(TerminalSummary("only", "p", "Only", null, null))
        composeRule.setContent {
            TerminalSwiper(
                terminals = one,
                initialIndex = 0,
                page = { Text("page-${it.id}", modifier = Modifier.testTag("page-${it.id}")) },
            )
        }
        composeRule.onNodeWithTag("page-only").assertIsDisplayed()
    }
}
