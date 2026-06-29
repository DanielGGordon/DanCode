package com.dancode.android.auth

import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.test.runTest
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Acceptance criterion 3 (paraphrased): "accept a configurable server base
 * URL plus username/password/TOTP, POST to /api/auth/login, persist the
 * returned token in EncryptedSharedPreferences".
 *
 * The controller is where that whole sequence is exercised end-to-end:
 * collect form input, call AuthApi, persist via TokenStorage, route on.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class LoginControllerTest {

    private lateinit var server: MockWebServer
    private lateinit var storage: TokenStorage

    @Before
    fun setUp() {
        server = MockWebServer().apply { start() }
        storage = TokenStorage.create(
            ApplicationProvider.getApplicationContext(),
            prefsFileName = "login-controller-test-prefs",
        )
        storage.clear()
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    private fun controller(onLoggedIn: () -> Unit = {}): LoginController =
        LoginController(
            authApi = AuthApi(OkHttpClient()),
            tokenStorage = storage,
            onLoggedIn = onLoggedIn,
            initialServerUrl = server.url("/").toString().trimEnd('/'),
        )

    @Test
    fun submit_persists_token_and_invokes_callback_on_success() = runTest {
        server.enqueue(MockResponse().setBody("""{"token":"the-token"}"""))
        var loggedIn = false
        val ctrl = controller(onLoggedIn = { loggedIn = true })
        ctrl.updateUsername("dan")
        ctrl.updatePassword("pw")
        ctrl.updateTotp("123456")

        ctrl.submit()

        assertEquals("the-token", storage.read())
        assertTrue(loggedIn)
        assertNull(ctrl.state.value.errorMessage)
        assertFalse(ctrl.state.value.isSubmitting)
    }

    @Test
    fun submit_surfaces_error_message_on_401() = runTest {
        server.enqueue(
            MockResponse().setResponseCode(401)
                .setBody("""{"error":"Invalid credentials"}"""),
        )
        var loggedIn = false
        val ctrl = controller(onLoggedIn = { loggedIn = true })
        ctrl.updateUsername("dan")
        ctrl.updatePassword("nope")
        ctrl.updateTotp("000000")

        ctrl.submit()

        assertNull(storage.read())
        assertFalse(loggedIn)
        assertEquals("Invalid credentials", ctrl.state.value.errorMessage)
    }

    @Test
    fun submit_surfaces_generic_error_on_network_failure() = runTest {
        server.shutdown()
        val ctrl = controller()
        ctrl.updateUsername("dan")
        ctrl.updatePassword("pw")
        ctrl.updateTotp("123456")

        ctrl.submit()

        assertNull(storage.read())
        assertTrue(
            "expected a non-null error, got ${ctrl.state.value.errorMessage}",
            !ctrl.state.value.errorMessage.isNullOrBlank(),
        )
    }

    @Test
    fun submit_rejects_empty_fields_without_hitting_the_network() = runTest {
        val ctrl = controller()

        ctrl.submit()

        assertNull(storage.read())
        assertEquals(0, server.requestCount)
        assertTrue(
            "expected a non-null error, got ${ctrl.state.value.errorMessage}",
            !ctrl.state.value.errorMessage.isNullOrBlank(),
        )
    }

    @Test
    fun submit_uses_the_configurable_server_url() = runTest {
        server.enqueue(MockResponse().setBody("""{"token":"t"}"""))
        val ctrl = controller()
        ctrl.updateServerUrl(server.url("/").toString().trimEnd('/'))
        ctrl.updateUsername("dan")
        ctrl.updatePassword("pw")
        ctrl.updateTotp("123456")

        ctrl.submit()

        val recorded = server.takeRequest()
        assertEquals("/api/auth/login", recorded.path)
    }
}
