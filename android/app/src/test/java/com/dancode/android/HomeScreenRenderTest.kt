package com.dancode.android

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import com.dancode.android.ui.HomeScreen
import com.dancode.android.ui.HomeScreenTags
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Drives the existence of a placeholder element on the root composable.
 *
 * Robolectric supplies an Android runtime + display so the Compose test
 * library can mount the tree headlessly — no emulator or device needed.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class HomeScreenRenderTest {

    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun home_screen_shows_placeholder_text() {
        composeRule.setContent { HomeScreen() }

        composeRule.onNodeWithTag(HomeScreenTags.PLACEHOLDER).assertIsDisplayed()
        composeRule.onNodeWithText("DanCode").assertIsDisplayed()
    }
}
