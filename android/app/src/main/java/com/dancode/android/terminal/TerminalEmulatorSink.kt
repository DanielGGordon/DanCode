package com.dancode.android.terminal

import com.termux.terminal.RemoteTerminalSession

/**
 * Production [TerminalSink] backed by a [RemoteTerminalSession]'s
 * emulator. The connection layer never touches the emulator directly —
 * everything goes through `write`/`reset` so reconnect-dedup is enforced
 * in exactly one place.
 *
 * Threading: socket.io callbacks run on the io-client thread. The
 * Termux `TerminalEmulator` is not thread-safe, so the host composable
 * is responsible for marshalling these calls onto the main thread (it
 * uses [android.os.Handler#post]). Tests construct the sink on the JUnit
 * thread; no concurrency is exercised there.
 */
class TerminalEmulatorSink(
    private val session: RemoteTerminalSession,
) : TerminalSink {

    override fun write(data: String) {
        val bytes = data.toByteArray(Charsets.UTF_8)
        session.getEmulator()?.append(bytes, bytes.size)
    }

    override fun reset() {
        // Termux's `TerminalEmulator.reset()` resets the cursor/effect
        // state but does NOT clear the visible cells, so the ring-buffer
        // replay would render on top of the previous frame. We send
        // RIS + exit-alt-screen + erase-scrollback + erase-display +
        // cursor-home: that combination wipes the active screen, the
        // alt-screen, the scrollback, and the cursor effects so the
        // replay starts on a blank screen.
        write(CLEAR_SEQUENCE)
        session.reset()
    }

    private companion object {
        private const val ESC = ""
        private val CLEAR_SEQUENCE: String =
            ESC + "c" +              // RIS — full reset
            ESC + "[?1049l" +        // exit alt screen
            ESC + "[3J" +            // erase scrollback
            ESC + "[2J" +            // erase visible
            ESC + "[H"               // home cursor
    }
}
