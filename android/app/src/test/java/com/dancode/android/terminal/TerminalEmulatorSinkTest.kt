package com.dancode.android.terminal

import com.termux.terminal.RemoteTerminalSession
import com.termux.terminal.TerminalEmulator
import com.termux.terminal.TerminalSession
import com.termux.terminal.TerminalSessionClient
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The sink that the [TerminalConnection] pushes server output into. It
 * wraps the [TerminalEmulator] from a [RemoteTerminalSession] so a
 * "write" appends bytes (the standard append the golden tests use), and
 * a "reset" clears the screen and scroll state — the critical bit for
 * reconnect dedup.
 *
 * `TerminalBuffer.getSelectedText(x1, y1, x2, y2)` includes endpoint
 * cells AND strips trailing spaces from each row, so "row 0" is checked
 * by selecting `(0, 0, columns-1, 0)` and trimming the residue.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class TerminalEmulatorSinkTest {

    private val cols = 20
    private val rows = 5

    @Test
    fun write_appends_bytes_into_the_emulator_screen() {
        val session = RemoteTerminalSession(client = NoopClient, outputBytes = { _, _, _ -> })
        session.initializeEmulator(cols, rows, 12, 24)
        val sink = TerminalEmulatorSink(session)

        sink.write("hello")

        assertEquals("hello", row0(session))
    }

    @Test
    fun reset_clears_emulator_state_so_next_replay_starts_from_a_blank_screen() {
        val session = RemoteTerminalSession(client = NoopClient, outputBytes = { _, _, _ -> })
        session.initializeEmulator(cols, rows, 12, 24)
        val sink = TerminalEmulatorSink(session)
        sink.write("hello")
        assertEquals("hello", row0(session))

        sink.reset()
        sink.write("x")

        // After reset+write the screen contains *only* "x" at (0, 0) —
        // no "hello" residue.
        assertEquals("x", row0(session))
    }

    private fun row0(session: RemoteTerminalSession): String =
        session.getEmulator()!!.screen.getSelectedText(0, 0, cols - 1, 0)

    private object NoopClient : TerminalSessionClient {
        override fun onTextChanged(s: TerminalSession) {}
        override fun onTitleChanged(s: TerminalSession) {}
        override fun onSessionFinished(s: TerminalSession) {}
        override fun onCopyTextToClipboard(s: TerminalSession, t: String?) {}
        override fun onPasteTextFromClipboard(s: TerminalSession?) {}
        override fun onBell(s: TerminalSession) {}
        override fun onColorsChanged(s: TerminalSession) {}
        override fun onTerminalCursorStateChange(state: Boolean) {}
        override fun setTerminalShellPid(s: TerminalSession, pid: Int) {}
        override fun getTerminalCursorStyle(): Int? = null
        override fun logError(tag: String?, message: String?) {}
        override fun logWarn(tag: String?, message: String?) {}
        override fun logInfo(tag: String?, message: String?) {}
        override fun logDebug(tag: String?, message: String?) {}
        override fun logVerbose(tag: String?, message: String?) {}
        override fun logStackTraceWithMessage(tag: String?, msg: String?, e: Exception?) {}
        override fun logStackTrace(tag: String?, e: Exception?) {}
    }
}
