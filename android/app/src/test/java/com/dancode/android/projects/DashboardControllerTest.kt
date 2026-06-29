package com.dancode.android.projects

import com.dancode.android.net.BearerAuthInterceptor
import kotlinx.coroutines.test.runTest
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Acceptance criterion 4 (final clause): "a 401 response routes back to
 * the login screen". The controller is the one place that decides what
 * happens on each response so the screen can stay a dumb view.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class DashboardControllerTest {

    private lateinit var server: MockWebServer

    @Before
    fun setUp() {
        server = MockWebServer().apply { start() }
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    private fun controller(token: String?, onUnauthorized: () -> Unit) = DashboardController(
        api = ProjectsApi(
            OkHttpClient.Builder()
                .addInterceptor(BearerAuthInterceptor { token })
                .build(),
        ),
        baseUrl = server.url("/").toString(),
        onUnauthorized = onUnauthorized,
    )

    @Test
    fun load_transitions_to_loaded_on_200() = runTest {
        server.enqueue(MockResponse().setBody("""[{"name":"X","slug":"x","path":"/p"}]"""))
        var unauthorized = false
        val ctrl = controller("tok") { unauthorized = true }

        ctrl.load()

        assertFalse(unauthorized)
        val state = ctrl.state.value
        assertTrue("expected Loaded, got $state", state is DashboardState.Loaded)
        assertEquals("X", (state as DashboardState.Loaded).projects[0].name)
    }

    @Test
    fun load_invokes_on_unauthorized_callback_on_401() = runTest {
        server.enqueue(MockResponse().setResponseCode(401).setBody("""{"error":"x"}"""))
        var unauthorized = false
        val ctrl = controller("expired") { unauthorized = true }

        ctrl.load()

        assertTrue(unauthorized)
    }

    @Test
    fun load_transitions_to_error_on_500() = runTest {
        server.enqueue(MockResponse().setResponseCode(500).setBody("boom"))
        val ctrl = controller("tok") {}

        ctrl.load()

        val state = ctrl.state.value
        assertTrue("expected Error, got $state", state is DashboardState.Error)
    }

    @Test
    fun load_transitions_to_error_on_network_failure() = runTest {
        server.shutdown()
        val ctrl = controller("tok") {}

        ctrl.load()

        assertTrue(ctrl.state.value is DashboardState.Error)
    }
}
