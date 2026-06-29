package com.dancode.android.auth

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performTextInput
import androidx.test.core.app.ApplicationProvider
import okhttp3.OkHttpClient
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Drives the visual contract of [LoginScreen]: the four form fields,
 * submit button, and default server URL all render. Form-state logic is
 * covered by [LoginControllerTest].
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class LoginScreenRenderTest {

    @get:Rule
    val composeRule = createComposeRule()

    private fun newController() = LoginController(
        authApi = AuthApi(OkHttpClient()),
        tokenStorage = TokenStorage.create(
            ApplicationProvider.getApplicationContext(),
            prefsFileName = "login-screen-test-prefs",
        ),
        onLoggedIn = {},
    )

    @Test
    fun renders_all_form_fields_and_submit_button() {
        composeRule.setContent { LoginScreen(controller = newController()) }

        composeRule.onNodeWithTag(LoginScreenTags.SERVER_URL).assertIsDisplayed()
        composeRule.onNodeWithTag(LoginScreenTags.USERNAME).assertIsDisplayed()
        composeRule.onNodeWithTag(LoginScreenTags.PASSWORD).assertIsDisplayed()
        composeRule.onNodeWithTag(LoginScreenTags.TOTP).assertIsDisplayed()
        composeRule.onNodeWithTag(LoginScreenTags.SUBMIT).assertIsDisplayed()
        composeRule.onNodeWithText("Log in").assertIsDisplayed()
    }

    @Test
    fun typing_into_username_updates_the_controller_state() {
        val controller = newController()
        composeRule.setContent { LoginScreen(controller = controller) }

        composeRule.onNodeWithTag(LoginScreenTags.USERNAME).performTextInput("dan")

        assert(controller.state.value.username == "dan") {
            "expected controller.username = dan, got ${controller.state.value.username}"
        }
    }
}
