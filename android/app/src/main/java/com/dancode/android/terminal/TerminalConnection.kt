package com.dancode.android.terminal

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Owns the connection lifecycle for one terminal: drives the
 * [TerminalTransport], routes output to a [TerminalSink], and exposes a
 * five-state machine the UI can observe to render its reconnecting
 * overlay.
 *
 * The reconnect-dedup invariant: on every *re*connect the sink is
 * cleared+reset *before* any output is written. The server replays its
 * ~50KB ring buffer on every connect; without the reset the user would
 * see the buffer twice (once kept from before disconnect, once on
 * replay).
 */
class TerminalConnection(
    private val transport: TerminalTransport,
    private val sink: TerminalSink,
    private val namespace: String,
    private val token: String,
) : TransportListener {

    enum class State { Idle, Connecting, Connected, Reconnecting, Disconnected }

    private val _state = MutableStateFlow(State.Idle)
    val state: StateFlow<State> = _state.asStateFlow()

    private var hasEverConnected = false
    private var resetPendingForReplay = false
    private val pendingResize = ArrayDeque<Pair<Int, Int>>()

    init {
        transport.listener = this
    }

    fun start() {
        if (_state.value == State.Disconnected) return
        _state.value = State.Connecting
        transport.connect(namespace, token)
    }

    fun stop() {
        _state.value = State.Disconnected
        transport.disconnect()
    }

    fun sendLine(line: String) {
        if (_state.value != State.Connected) return
        transport.sendInput(TerminalInputEncoder.cookedLine(line))
    }

    /**
     * Forward [data] to the PTY verbatim. Used by the on-screen control
     * key bar and the SGR mouse-wheel encoder — neither of which wants
     * cooked-mode line-buffering.
     */
    fun sendRaw(data: String) {
        if (_state.value != State.Connected) return
        if (data.isEmpty()) return
        transport.sendInput(data)
    }

    fun sendResize(cols: Int, rows: Int) {
        if (_state.value == State.Connected) {
            transport.sendResize(cols, rows)
        } else {
            // Buffer; replay on (re)connect so the server always has a
            // size before output starts streaming.
            pendingResize.addLast(cols to rows)
        }
    }

    override fun onConnected() {
        _state.value = State.Connected
        if (hasEverConnected) {
            // This is a *re*connect — the next output is the server's
            // ring-buffer replay. Drop the old screen first.
            resetPendingForReplay = true
        }
        hasEverConnected = true
        // Replay any size measured before the socket finished its handshake.
        while (pendingResize.isNotEmpty()) {
            val (cols, rows) = pendingResize.removeFirst()
            transport.sendResize(cols, rows)
        }
    }

    override fun onOutput(data: String) {
        if (resetPendingForReplay) {
            sink.reset()
            resetPendingForReplay = false
        }
        sink.write(data)
    }

    override fun onDisconnected() {
        if (_state.value == State.Disconnected) return
        _state.value = State.Reconnecting
        // Reconnection policy: ask the transport to dial back in. The
        // production socket.io client also retries internally; this call
        // makes the intent explicit so a stub transport (and tests) sees
        // it.
        transport.connect(namespace, token)
    }

    override fun onExit(code: Int?) {
        _state.value = State.Disconnected
    }
}
