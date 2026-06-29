package com.dancode.android.terminal

/**
 * Socket.io-namespaced transport for a single terminal.
 *
 * The Phase 3 contract is intentionally narrow so the production
 * socket.io-backed implementation and the JVM fake used in tests stay
 * exchangeable. Lifecycle: [connect] is called whenever the
 * [TerminalConnection] wants a fresh dial-in (initial attach or
 * reconnect), [disconnect] tears the socket down for good.
 */
interface TerminalTransport {
    var listener: TransportListener?
    fun connect(namespace: String, token: String)
    fun disconnect()
    fun sendInput(data: String)
    fun sendResize(cols: Int, rows: Int)
}

interface TransportListener {
    fun onConnected()
    fun onOutput(data: String)
    fun onDisconnected()
    fun onExit(code: Int?)
}

/**
 * Where bytes coming back from the PTY ultimately go and how the
 * connection layer clears the screen before a reconnect replay. The
 * production binding wires this to the Termux emulator/view; tests pass
 * an in-memory fake.
 */
interface TerminalSink {
    fun write(data: String)
    fun reset()
}
