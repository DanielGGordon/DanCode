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
 * Wire contract for `GET /api/terminals?project=<slug>`. Returns the JSON
 * array shape `shellhost-terminal-manager` emits — at minimum `id`,
 * `projectSlug`, `label`, `command`, `cwd` — plus a sealed result type
 * mirroring [com.dancode.android.projects.ProjectsApi] so the controller
 * layer can route 401 → re-login uniformly.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class TerminalsApiTest {

    private lateinit var server: MockWebServer

    @Before
    fun setUp() {
        server = MockWebServer().apply { start() }
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    private fun api(token: String?) = TerminalsApi(
        OkHttpClient.Builder()
            .addInterceptor(BearerAuthInterceptor { token })
            .build(),
    )

    @Test
    fun list_sends_bearer_and_project_query_parameter() = runTest {
        server.enqueue(MockResponse().setBody("[]"))

        api("tok-xyz").list(baseUrl = server.url("/").toString(), projectSlug = "dancode")

        val recorded = server.takeRequest()
        assertEquals("GET", recorded.method)
        assertEquals("/api/terminals?project=dancode", recorded.path)
        assertEquals("Bearer tok-xyz", recorded.getHeader("Authorization"))
    }

    @Test
    fun list_returns_parsed_terminals_on_200() = runTest {
        server.enqueue(
            MockResponse().setBody(
                """[
                |{"id":"t-1","projectSlug":"dancode","label":"CLI","command":"bash","cwd":"/home/d"},
                |{"id":"t-2","projectSlug":"dancode","label":"Claude","command":"claude","cwd":"/home/d"}
                |]""".trimMargin(),
            ),
        )

        val result = api("tok").list(server.url("/").toString(), "dancode")

        assertTrue("expected Success, got $result", result is TerminalsApi.ListResult.Success)
        val terminals = (result as TerminalsApi.ListResult.Success).terminals
        assertEquals(2, terminals.size)
        assertEquals("t-1", terminals[0].id)
        assertEquals("CLI", terminals[0].label)
        assertEquals("bash", terminals[0].command)
        assertEquals("Claude", terminals[1].label)
    }

    @Test
    fun list_tolerates_missing_optional_fields() = runTest {
        server.enqueue(
            MockResponse().setBody(
                """[{"id":"t-1","projectSlug":"dancode","label":"Bare"}]""",
            ),
        )

        val terminals = (api("tok").list(server.url("/").toString(), "dancode")
            as TerminalsApi.ListResult.Success).terminals
        assertEquals("t-1", terminals[0].id)
        assertEquals(null, terminals[0].command)
        assertEquals(null, terminals[0].cwd)
    }

    @Test
    fun list_returns_unauthorized_on_401() = runTest {
        server.enqueue(MockResponse().setResponseCode(401))

        val result = api("expired").list(server.url("/").toString(), "dancode")

        assertEquals(TerminalsApi.ListResult.Unauthorized, result)
    }

    @Test
    fun list_returns_failure_on_500() = runTest {
        server.enqueue(MockResponse().setResponseCode(500).setBody("boom"))

        val result = api("tok").list(server.url("/").toString(), "dancode")

        assertTrue("expected Failure, got $result", result is TerminalsApi.ListResult.Failure)
        assertEquals(500, (result as TerminalsApi.ListResult.Failure).statusCode)
    }
}
