package com.dancode.android.terminal

import com.termux.terminal.RemoteTerminalSession
import com.termux.terminal.TerminalSession
import com.termux.terminal.TerminalSessionClient
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * End-to-end golden test for the alt-screen → Raw transition.
 *
 * Drives the real Termux [com.termux.terminal.TerminalEmulator] with a
 * recorded byte stream that mimics what Claude Code (and any other
 * full-screen TUI) emits on startup:
 *  - DECSET 1049: enter alt screen
 *  - DECSET 1006 + 1000: enable SGR mouse-tracking
 *  - DECRST 1049: leave alt screen
 *
 * After feeding each chunk we read the emulator's `isAlternateBufferActive`
 * and `isMouseTrackingActive` flags and ask [InputModePolicy] to resolve a
 * mode. Acceptance criterion (Phase 4): Raw while alt-screen / tracking is
 * on, Cooked when both are off.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class AltScreenRawModeTransitionTest {

    private val cols = 80
    private val rows = 24
    private val ESC = ""

    @Test
    fun starts_in_cooked_mode_on_a_fresh_emulator() {
        val session = newSession()
        val policy = InputModePolicy()
        assertEquals(InputMode.Cooked, policy.resolve(snapshot(session)))
    }

    @Test
    fun decset_1049_flips_input_mode_to_raw() {
        val session = newSession()
        val policy = InputModePolicy()

        // Enter alt-screen — what Claude / vim / less write right after
        // startup. The `ESC[?1049h` sequence enables the alt buffer and
        // saves the cursor.
        write(session, "$ESC[?1049h")

        val state = snapshot(session)
        assertTrue("alt screen should be active", state.altScreenActive)
        assertEquals(InputMode.Raw, policy.resolve(state))
    }

    @Test
    fun decset_1000_then_1006_flips_to_raw_even_without_alt_screen() {
        val session = newSession()
        val policy = InputModePolicy()
        // Enable button-event tracking + SGR encoding (the modern combo).
        write(session, "$ESC[?1000h$ESC[?1006h")
        val state = snapshot(session)
        assertTrue("mouse tracking should be active", state.mouseTrackingActive)
        assertEquals(InputMode.Raw, policy.resolve(state))
    }

    @Test
    fun reverts_to_cooked_after_decrst_1049_and_mouse_tracking_off() {
        val session = newSession()
        val policy = InputModePolicy()

        // Enter alt + tracking → Raw
        write(session, "$ESC[?1049h$ESC[?1000h$ESC[?1006h")
        assertEquals(InputMode.Raw, policy.resolve(snapshot(session)))

        // Now Claude exits — DECRST 1049 + 1000.
        write(session, "$ESC[?1049l$ESC[?1000l")

        val after = snapshot(session)
        assertFalse("alt screen should be off", after.altScreenActive)
        assertFalse("mouse tracking should be off", after.mouseTrackingActive)
        assertEquals(InputMode.Cooked, policy.resolve(after))
    }

    @Test
    fun full_session_recording_drives_the_expected_mode_timeline() {
        val session = newSession()
        val policy = InputModePolicy()
        val timeline = mutableListOf<InputMode>()

        // Chunked playback so we observe the mode at each boundary —
        // exactly what the live emulator sink would see as the socket
        // pushes frames.
        val chunks = listOf(
            "Welcome\r\n",                              // 0: still in normal screen
            "$ESC[?1049h",                              // 1: alt-screen ON
            "$ESC[?1006h$ESC[?1000h",                   // 2: mouse-tracking on top
            "$ESC[?1000l",                              // 3: tracking off; alt still on
            "$ESC[?1049l",                              // 4: alt off → back to normal
        )
        for (c in chunks) {
            write(session, c)
            timeline += policy.resolve(snapshot(session))
        }

        assertEquals(
            listOf(
                InputMode.Cooked, // 0
                InputMode.Raw,    // 1
                InputMode.Raw,    // 2
                InputMode.Raw,    // 3 (alt-screen still on)
                InputMode.Cooked, // 4
            ),
            timeline,
        )
    }

    private fun newSession(): RemoteTerminalSession {
        val session = RemoteTerminalSession(client = NoopClient, outputBytes = { _, _, _ -> })
        session.initializeEmulator(cols, rows, 12, 24)
        return session
    }

    private fun write(session: RemoteTerminalSession, payload: String) {
        val bytes = payload.toByteArray(Charsets.UTF_8)
        session.getEmulator()!!.append(bytes, bytes.size)
    }

    private fun snapshot(session: RemoteTerminalSession): EmulatorModeState {
        val emu = session.getEmulator()!!
        return EmulatorModeState(
            altScreenActive = emu.isAlternateBufferActive,
            mouseTrackingActive = emu.isMouseTrackingActive,
        )
    }

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
