package com.dancode.android.projects

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
 * Drives the wire contract for `GET /api/projects`: Bearer-authenticated,
 * returns a JSON array of `{name,slug,path,...}` objects on 200 and 401 on
 * an expired/invalid token.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class ProjectsApiTest {

    private lateinit var server: MockWebServer

    @Before
    fun setUp() {
        server = MockWebServer().apply { start() }
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    private fun api(token: String?) = ProjectsApi(
        OkHttpClient.Builder()
            .addInterceptor(BearerAuthInterceptor { token })
            .build(),
    )

    @Test
    fun list_sends_bearer_token_to_api_projects() = runTest {
        server.enqueue(MockResponse().setBody("[]"))

        api("tok-xyz").list(baseUrl = server.url("/").toString())

        val recorded = server.takeRequest()
        assertEquals("GET", recorded.method)
        assertEquals("/api/projects", recorded.path)
        assertEquals("Bearer tok-xyz", recorded.getHeader("Authorization"))
    }

    @Test
    fun list_returns_parsed_projects_on_200() = runTest {
        server.enqueue(
            MockResponse().setBody(
                """[
                |{"name":"DanCode","slug":"dancode","path":"/home/dan/dc"},
                |{"name":"Other","slug":"other","path":"/home/dan/other"}
                |]""".trimMargin(),
            ),
        )

        val result = api("tok").list(baseUrl = server.url("/").toString())

        assertTrue("expected Success, got $result", result is ProjectsApi.ListResult.Success)
        val projects = (result as ProjectsApi.ListResult.Success).projects
        assertEquals(2, projects.size)
        assertEquals(Project(name = "DanCode", slug = "dancode", path = "/home/dan/dc"), projects[0])
        assertEquals("Other", projects[1].name)
        assertEquals("other", projects[1].slug)
    }

    @Test
    fun list_returns_unauthorized_on_401() = runTest {
        server.enqueue(
            MockResponse().setResponseCode(401)
                .setBody("""{"error":"Invalid token"}"""),
        )

        val result = api("expired").list(baseUrl = server.url("/").toString())

        assertEquals(ProjectsApi.ListResult.Unauthorized, result)
    }

    @Test
    fun list_returns_failure_on_other_error_codes() = runTest {
        server.enqueue(MockResponse().setResponseCode(500).setBody("boom"))

        val result = api("tok").list(baseUrl = server.url("/").toString())

        assertTrue("expected Failure, got $result", result is ProjectsApi.ListResult.Failure)
        assertEquals(500, (result as ProjectsApi.ListResult.Failure).statusCode)
    }

    @Test
    fun list_tolerates_extra_unknown_fields_in_each_project() = runTest {
        server.enqueue(
            MockResponse().setBody(
                """[{"name":"X","slug":"x","path":"/p","createdAt":"2026-01-01","terminals":["t1"]}]""",
            ),
        )

        val result = api("tok").list(baseUrl = server.url("/").toString())

        val projects = (result as ProjectsApi.ListResult.Success).projects
        assertEquals(1, projects.size)
        assertEquals("X", projects[0].name)
    }
}
