package com.dancode.android.terminal

import io.socket.client.IO
import io.socket.client.Socket
import okhttp3.OkHttpClient

/**
 * Production [TerminalTransport] backed by socket.io-client over the
 * pinned-TLS endpoint configured in Phase 2.
 *
 * The transport is intentionally thin: lifecycle decisions (when to
 * reconnect, when to reset the sink, what state to emit) live in
 * [TerminalConnection]; this class only marshals events between
 * `socket.io` and the [TransportListener] interface, and emits the
 * `input` / `resize` payloads the server expects.
 */
class SocketIoTransport(
    private val baseUrl: String,
    private val httpClient: OkHttpClient,
) : TerminalTransport {

    override var listener: TransportListener? = null

    private var socket: Socket? = null

    override fun connect(namespace: String, token: String) {
        // The server's socket.io route is `${baseUrl}${namespace}`, e.g.
        // `https://5.78.231.51:<port>/terminal/<uuid>`. The Java client
        // splits the path itself when a namespace path is present.
        val url = baseUrl.trimEnd('/') + namespace
        val options = buildOptions(token = token, httpClient = httpClient)
        val s = IO.socket(url, options)
        socket = s
        s.on(Socket.EVENT_CONNECT) { listener?.onConnected() }
        s.on(Socket.EVENT_DISCONNECT) { listener?.onDisconnected() }
        s.on("output") { args ->
            val data = (args.firstOrNull() as? String) ?: return@on
            listener?.onOutput(data)
        }
        s.on("exit") { args ->
            val code = (args.firstOrNull() as? Number)?.toInt()
            listener?.onExit(code)
        }
        s.connect()
    }

    override fun disconnect() {
        socket?.let { it.disconnect(); it.off() }
        socket = null
    }

    override fun sendInput(data: String) {
        socket?.emit("input", data)
    }

    override fun sendResize(cols: Int, rows: Int) {
        val payload = org.json.JSONObject().apply {
            put("cols", cols)
            put("rows", rows)
        }
        socket?.emit("resize", payload)
    }

    companion object {
        fun buildOptions(token: String, httpClient: OkHttpClient): IO.Options {
            return IO.Options.builder()
                .setTransports(arrayOf("websocket"))
                .setAuth(mapOf("token" to token))
                .setReconnection(true)
                .build()
                .also {
                    // Reuse the pinned-TLS OkHttp client for both raw HTTP
                    // (handshake) and the underlying WebSocket. Without
                    // this the engine.io layer would build its own client
                    // and bypass the cert pin.
                    it.callFactory = httpClient
                    it.webSocketFactory = httpClient
                }
        }
    }
}
