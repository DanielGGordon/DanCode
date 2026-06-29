package com.dancode.android.net

import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test

/**
 * Drives the wire contract of [BearerAuthInterceptor]: when a token is
 * available from the provider, the request reaches the server with the
 * `Authorization: Bearer <token>` header; otherwise the header is absent so
 * the unauthenticated request can be handled by the caller (e.g. login).
 */
class BearerAuthInterceptorTest {

    private lateinit var server: MockWebServer

    @Before
    fun setUp() {
        server = MockWebServer().apply { start() }
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    @Test
    fun adds_bearer_header_when_token_is_present() {
        server.enqueue(MockResponse().setBody("[]"))
        val client = OkHttpClient.Builder()
            .addInterceptor(BearerAuthInterceptor { "tok-abc" })
            .build()

        client.newCall(Request.Builder().url(server.url("/api/projects")).build()).execute()

        val recorded = server.takeRequest()
        assertEquals("Bearer tok-abc", recorded.getHeader("Authorization"))
    }

    @Test
    fun omits_bearer_header_when_token_is_null() {
        server.enqueue(MockResponse().setBody("ok"))
        val client = OkHttpClient.Builder()
            .addInterceptor(BearerAuthInterceptor { null })
            .build()

        client.newCall(Request.Builder().url(server.url("/api/auth/login")).build()).execute()

        val recorded = server.takeRequest()
        assertNull(recorded.getHeader("Authorization"))
    }
}
