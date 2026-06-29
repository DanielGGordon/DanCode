package com.dancode.android.terminal

import com.dancode.android.net.BearerAuthInterceptor
import kotlinx.coroutines.test.runTest
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The terminal-list state holder. Mirrors `DashboardController`: 401
 * routes back to the login screen via [TerminalListController.onUnauthorized].
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class TerminalListControllerTest {

    private lateinit var server: MockWebServer

    @Before
    fun setUp() { server = MockWebServer().apply { start() } }

    @After
    fun tearDown() { server.shutdown() }

    @Test
    fun load_starts_in_loading_then_emits_loaded_with_terminals() = runTest {
        server.enqueue(MockResponse().setBody(
            """[{"id":"t-1","projectSlug":"x","label":"CLI"}]""",
        ))
        var unauthorized = false
        val controller = TerminalListController(
            api = TerminalsApi(OkHttpClient.Builder().addInterceptor(BearerAuthInterceptor { "tok" }).build()),
            baseUrl = server.url("/").toString(),
            projectSlug = "x",
            onUnauthorized = { unauthorized = true },
        )
        controller.load()
        val state = controller.state.value
        assertTrue("expected Loaded, got $state", state is TerminalListState.Loaded)
        assertEquals(1, (state as TerminalListState.Loaded).terminals.size)
        assertEquals("t-1", state.terminals[0].id)
        assertEquals(false, unauthorized)
    }

    @Test
    fun load_on_401_calls_on_unauthorized_and_sets_error_state() = runTest {
        server.enqueue(MockResponse().setResponseCode(401))
        var unauthorized = false
        val controller = TerminalListController(
            api = TerminalsApi(OkHttpClient()),
            baseUrl = server.url("/").toString(),
            projectSlug = "x",
            onUnauthorized = { unauthorized = true },
        )
        controller.load()
        assertEquals(true, unauthorized)
        assertTrue(controller.state.value is TerminalListState.Error)
    }

    @Test
    fun load_on_500_sets_error_state_without_unauthorized() = runTest {
        server.enqueue(MockResponse().setResponseCode(500).setBody("boom"))
        var unauthorized = false
        val controller = TerminalListController(
            api = TerminalsApi(OkHttpClient()),
            baseUrl = server.url("/").toString(),
            projectSlug = "x",
            onUnauthorized = { unauthorized = true },
        )
        controller.load()
        assertEquals(false, unauthorized)
        assertTrue(controller.state.value is TerminalListState.Error)
    }
}
