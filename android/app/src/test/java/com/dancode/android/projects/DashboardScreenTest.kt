package com.dancode.android.projects

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
 * Acceptance criterion 4 (paraphrased): "after authentication the app
 * renders a dashboard list of project names". This drives the pure render
 * path — a stateful loader is exercised separately by [DashboardControllerTest].
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class DashboardScreenTest {

    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun renders_each_project_name_from_loaded_state() {
        val projects = listOf(
            Project(name = "DanCode", slug = "dancode", path = "/p"),
            Project(name = "Notes", slug = "notes", path = "/q"),
        )

        composeRule.setContent {
            DashboardScreen(state = DashboardState.Loaded(projects))
        }

        composeRule.onNodeWithTag(DashboardScreenTags.PROJECT_LIST).assertIsDisplayed()
        composeRule.onNodeWithText("DanCode").assertIsDisplayed()
        composeRule.onNodeWithText("Notes").assertIsDisplayed()
    }

    @Test
    fun renders_a_loading_indicator_in_loading_state() {
        composeRule.setContent { DashboardScreen(state = DashboardState.Loading) }

        composeRule.onNodeWithTag(DashboardScreenTags.LOADING).assertIsDisplayed()
    }

    @Test
    fun renders_an_error_message_in_error_state() {
        composeRule.setContent {
            DashboardScreen(state = DashboardState.Error("Network error"))
        }

        composeRule.onNodeWithText("Network error").assertIsDisplayed()
    }

    @Test
    fun renders_an_empty_hint_when_no_projects() {
        composeRule.setContent {
            DashboardScreen(state = DashboardState.Loaded(emptyList()))
        }

        composeRule.onNodeWithTag(DashboardScreenTags.EMPTY).assertIsDisplayed()
    }

    @Test
    fun tapping_a_project_row_invokes_on_select_with_that_project() {
        val projects = listOf(
            Project(name = "DanCode", slug = "dancode", path = "/p"),
            Project(name = "Notes", slug = "notes", path = "/q"),
        )
        var selected: Project? = null
        composeRule.setContent {
            DashboardScreen(
                state = DashboardState.Loaded(projects),
                onSelect = { selected = it },
            )
        }

        composeRule.onNodeWithTag(DashboardScreenTags.PROJECT_ITEM_PREFIX + "notes")
            .performClick()

        assertEquals(projects[1], selected)
    }
}
