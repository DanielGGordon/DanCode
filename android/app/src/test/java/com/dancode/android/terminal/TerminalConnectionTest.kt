package com.dancode.android.terminal

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Connection-state machine + reconnect dedup contract.
 *
 * The Socket.io path is held behind [TerminalTransport]; this test drives
 * a deterministic fake and only asserts on observable behavior — the
 * [TerminalConnection]'s state transitions, what bytes flow to the
 * [TerminalSink], and the calls forwarded to the transport. Acceptance
 * criterion: on a *re*connect the sink must be cleared+reset *before* the
 * replay is written, otherwise the server's ring buffer would visibly
 * duplicate.
 */
class TerminalConnectionTest {

    @Test
    fun starts_in_idle_state() {
        val (conn, _, _) = build()
        assertEquals(TerminalConnection.State.Idle, conn.state.value)
    }

    @Test
    fun start_calls_transport_connect_with_namespace_and_token() {
        val (conn, transport, _) = build(namespace = "/terminal/abc", token = "tok-1")
        conn.start()
        assertEquals(listOf("connect:/terminal/abc:tok-1"), transport.calls)
        assertEquals(TerminalConnection.State.Connecting, conn.state.value)
    }

    @Test
    fun transport_connected_event_moves_to_connected() {
        val (conn, transport, _) = build()
        conn.start()
        transport.listener!!.onConnected()
        assertEquals(TerminalConnection.State.Connected, conn.state.value)
    }

    @Test
    fun output_events_are_written_to_the_sink_in_order() {
        val (conn, transport, sink) = build()
        conn.start()
        transport.listener!!.onConnected()
        transport.listener!!.onOutput("hello ")
        transport.listener!!.onOutput("world")
        assertEquals(listOf("write:hello ", "write:world"), sink.calls)
    }

    @Test
    fun first_connect_does_not_reset_the_sink_so_initial_replay_is_kept() {
        val (conn, transport, sink) = build()
        conn.start()
        transport.listener!!.onConnected()
        transport.listener!!.onOutput("initial-replay")
        assertFalse("sink.reset must not run on first connect", sink.calls.contains("reset"))
        assertEquals(listOf("write:initial-replay"), sink.calls)
    }

    @Test
    fun disconnect_moves_to_reconnecting_and_resets_sink_before_next_output() {
        val (conn, transport, sink) = build()
        conn.start()
        transport.listener!!.onConnected()
        transport.listener!!.onOutput("a")
        transport.listener!!.onDisconnected()
        assertEquals(TerminalConnection.State.Reconnecting, conn.state.value)
        // Reconnect; the *first* output after this must be preceded by a reset.
        transport.listener!!.onConnected()
        transport.listener!!.onOutput("b")
        val resetIdx = sink.calls.indexOf("reset")
        val writeBIdx = sink.calls.indexOf("write:b")
        assertTrue("sink.reset must be called on reconnect", resetIdx >= 0)
        assertTrue("reset must happen before the replay output", resetIdx < writeBIdx)
    }

    @Test
    fun reconnect_then_disconnect_then_reconnect_resets_each_time() {
        val (conn, transport, sink) = build()
        conn.start()
        transport.listener!!.onConnected()
        transport.listener!!.onOutput("x")
        // cycle 1
        transport.listener!!.onDisconnected()
        transport.listener!!.onConnected()
        transport.listener!!.onOutput("y")
        // cycle 2
        transport.listener!!.onDisconnected()
        transport.listener!!.onConnected()
        transport.listener!!.onOutput("z")
        val resetCount = sink.calls.count { it == "reset" }
        assertEquals("one reset per reconnect", 2, resetCount)
    }

    @Test
    fun automatic_reconnect_requests_a_fresh_transport_connect() {
        val (conn, transport, _) = build()
        conn.start()
        transport.listener!!.onConnected()
        transport.calls.clear()
        transport.listener!!.onDisconnected()
        // The connection must ask the transport to dial back in; the real
        // socket.io client also retries internally, but the state machine
        // drives reconnection so a manual `start()` is not required from
        // the UI layer.
        assertTrue(
            "expected a connect after onDisconnected, got ${transport.calls}",
            transport.calls.any { it.startsWith("connect:") },
        )
    }

    @Test
    fun stop_disconnects_transport_and_moves_to_disconnected_state() {
        val (conn, transport, _) = build()
        conn.start()
        transport.listener!!.onConnected()
        conn.stop()
        assertEquals(TerminalConnection.State.Disconnected, conn.state.value)
        assertTrue("expected transport.disconnect to be called", transport.calls.contains("disconnect"))
    }

    @Test
    fun after_stop_no_further_reconnect_attempts_are_made() {
        val (conn, transport, _) = build()
        conn.start()
        transport.listener!!.onConnected()
        conn.stop()
        transport.calls.clear()
        // A late disconnect notification arriving after stop must not
        // schedule a reconnect (the socket is already dead).
        transport.listener!!.onDisconnected()
        assertEquals(emptyList<String>(), transport.calls)
        assertEquals(TerminalConnection.State.Disconnected, conn.state.value)
    }

    @Test
    fun send_line_uses_input_encoder_and_forwards_via_transport() = runTest {
        val (conn, transport, _) = build()
        conn.start()
        transport.listener!!.onConnected()
        conn.sendLine("ls")
        assertTrue(
            "expected input:ls\\r got ${transport.calls}",
            transport.calls.contains("input:ls\r"),
        )
    }

    @Test
    fun send_resize_forwards_cols_and_rows_to_transport() {
        val (conn, transport, _) = build()
        conn.start()
        transport.listener!!.onConnected()
        conn.sendResize(cols = 80, rows = 24)
        assertTrue(
            "expected resize:80x24 got ${transport.calls}",
            transport.calls.contains("resize:80x24"),
        )
    }

    @Test
    fun resize_calls_before_connect_are_buffered_and_replayed_after_connect() {
        val (conn, transport, _) = build()
        conn.start()
        // The view's onSizeChanged can fire before the socket has connected.
        conn.sendResize(cols = 100, rows = 30)
        assertFalse(
            "must not send resize before connected",
            transport.calls.any { it.startsWith("resize:") },
        )
        transport.listener!!.onConnected()
        assertTrue(
            "expected buffered resize replayed after connect, got ${transport.calls}",
            transport.calls.contains("resize:100x30"),
        )
    }

    private fun build(
        namespace: String = "/terminal/t-1",
        token: String = "tok",
    ): Triple<TerminalConnection, FakeTransport, FakeSink> {
        val transport = FakeTransport()
        val sink = FakeSink()
        val conn = TerminalConnection(
            transport = transport,
            sink = sink,
            namespace = namespace,
            token = token,
        )
        return Triple(conn, transport, sink)
    }

    private class FakeTransport : TerminalTransport {
        val calls = mutableListOf<String>()
        override var listener: TransportListener? = null
        override fun connect(namespace: String, token: String) {
            calls += "connect:$namespace:$token"
        }
        override fun disconnect() { calls += "disconnect" }
        override fun sendInput(data: String) { calls += "input:$data" }
        override fun sendResize(cols: Int, rows: Int) { calls += "resize:${cols}x$rows" }
    }

    private class FakeSink : TerminalSink {
        val calls = mutableListOf<String>()
        override fun write(data: String) { calls += "write:$data" }
        override fun reset() { calls += "reset" }
    }
}
