package com.dancode.android.auth

import kotlinx.coroutines.test.runTest
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Drives the wire contract for `POST /api/auth/login` exactly as the
 * existing Node backend implements it (see server/src/index.js:179 and
 * server/src/auth.js): JSON body `{username,password,totpCode}`, success
 * returns `{token: "..."}` and 401 returns `{error: "..."}`.
 *
 * Robolectric is required because `org.json.JSONObject` lives in
 * android.jar — the JVM-only stub returns null and breaks the body
 * serialisation before the request is even sent.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class AuthApiTest {

    private lateinit var server: MockWebServer
    private lateinit var api: AuthApi

    @Before
    fun setUp() {
        server = MockWebServer().apply { start() }
        api = AuthApi(OkHttpClient())
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    @Test
    fun login_posts_credentials_as_json_to_api_auth_login() = runTest {
        server.enqueue(MockResponse().setBody("""{"token":"hex64"}"""))

        api.login(
            baseUrl = server.url("/").toString().trimEnd('/'),
            username = "dan",
            password = "pw",
            totpCode = "123456",
        )

        val recorded = server.takeRequest()
        assertEquals("POST", recorded.method)
        assertEquals("/api/auth/login", recorded.path)
        assertTrue(
            "expected JSON content type, got ${recorded.getHeader("Content-Type")}",
            recorded.getHeader("Content-Type")?.contains("application/json") == true,
        )
        val body = JSONObject(recorded.body.readUtf8())
        assertEquals("dan", body.getString("username"))
        assertEquals("pw", body.getString("password"))
        assertEquals("123456", body.getString("totpCode"))
    }

    @Test
    fun login_returns_token_on_200() = runTest {
        server.enqueue(MockResponse().setResponseCode(200).setBody("""{"token":"hex64"}"""))

        val result = api.login(
            baseUrl = server.url("/").toString().trimEnd('/'),
            username = "dan",
            password = "pw",
            totpCode = "123456",
        )

        assertEquals(AuthApi.LoginResult.Success("hex64"), result)
    }

    @Test
    fun login_returns_failure_with_status_and_message_on_401() = runTest {
        server.enqueue(
            MockResponse().setResponseCode(401)
                .setBody("""{"error":"Invalid credentials"}"""),
        )

        val result = api.login(
            baseUrl = server.url("/").toString().trimEnd('/'),
            username = "dan",
            password = "pw",
            totpCode = "000000",
        )

        assertEquals(AuthApi.LoginResult.Failure(401, "Invalid credentials"), result)
    }

    @Test
    fun login_accepts_base_url_with_or_without_trailing_slash() = runTest {
        server.enqueue(MockResponse().setBody("""{"token":"x"}"""))

        api.login(
            baseUrl = server.url("/").toString(), // trailing slash present
            username = "dan",
            password = "pw",
            totpCode = "123456",
        )

        assertEquals("/api/auth/login", server.takeRequest().path)
    }
}
