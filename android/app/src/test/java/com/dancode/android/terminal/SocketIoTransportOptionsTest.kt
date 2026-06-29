package com.dancode.android.terminal

import okhttp3.OkHttpClient
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Pure-JVM assertions about the IO.Options the socket.io transport builds.
 * The actual connect/handshake is exercised on-device against the live
 * backend (manual smoke); these tests gate the *configuration*: WebSocket
 * transport only, `auth.token` populated, pinned-TLS OkHttp client reused
 * for both socket-level call and webSocket factory.
 */
class SocketIoTransportOptionsTest {

    @Test
    fun build_options_carries_token_in_auth_map() {
        val opts = SocketIoTransport.buildOptions(
            token = "tok-42",
            httpClient = OkHttpClient(),
        )
        val authMap = opts.auth
        assertNotNull("options.auth should be populated", authMap)
        assertEquals("tok-42", authMap!!["token"])
    }

    @Test
    fun build_options_uses_websocket_transport_only() {
        val opts = SocketIoTransport.buildOptions(
            token = "tok",
            httpClient = OkHttpClient(),
        )
        val transports = opts.transports!!
        assertEquals(1, transports.size)
        assertEquals("websocket", transports[0])
    }

    @Test
    fun build_options_wires_okhttp_for_socket_factory_and_websocket_factory() {
        val client = OkHttpClient()
        val opts = SocketIoTransport.buildOptions(token = "tok", httpClient = client)
        assertEquals(client, opts.callFactory)
        assertEquals(client, opts.webSocketFactory)
    }

    @Test
    fun build_options_enables_automatic_reconnection() {
        val opts = SocketIoTransport.buildOptions(token = "tok", httpClient = OkHttpClient())
        assertTrue("socket.io reconnection must be enabled", opts.reconnection)
    }
}
