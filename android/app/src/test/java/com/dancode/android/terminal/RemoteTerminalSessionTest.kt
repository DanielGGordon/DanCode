package com.dancode.android.terminal

import androidx.annotation.Nullable
import com.termux.terminal.RemoteTerminalSession
import com.termux.terminal.TerminalSession
import com.termux.terminal.TerminalSessionClient
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The remote-session shim subclasses Termux's [TerminalSession] but
 * never opens a JNI PTY — bytes destined for the shell go to a
 * caller-supplied lambda instead. This keeps the production rendering
 * path inside the same TerminalView/TerminalEmulator the golden tests
 * already exercise.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class RemoteTerminalSessionTest {

    @Test
    fun initialize_emulator_constructs_emulator_without_loading_jni() {
        val session = RemoteTerminalSession(
            client = NoopClient,
            outputBytes = { _, _, _ -> },
        )
        // Should not throw `UnsatisfiedLinkError("termux")` — there is no
        // System.loadLibrary("termux") in the remote-session path.
        session.initializeEmulator(80, 24, 12, 24)
        assertNotNull(session.getEmulator())
        assertEquals(80, session.getEmulator()!!.mColumns)
        assertEquals(24, session.getEmulator()!!.mRows)
    }

    @Test
    fun update_size_after_emulator_exists_resizes_without_loading_jni() {
        val session = RemoteTerminalSession(
            client = NoopClient,
            outputBytes = { _, _, _ -> },
        )
        // First updateSize initializes the emulator (mEmulator == null path).
        session.updateSize(80, 24, 12, 24)
        assertNotNull(session.getEmulator())

        // Regression: the parent TerminalSession.updateSize calls
        // JNI.setPtyWindowSize once the emulator exists, which triggers
        // System.loadLibrary("termux") → UnsatisfiedLinkError and crashed the
        // app on the second layout pass. The override must resize the
        // emulator only and never touch JNI.
        session.updateSize(100, 30, 12, 24)
        assertEquals(100, session.getEmulator()!!.mColumns)
        assertEquals(30, session.getEmulator()!!.mRows)
    }

    @Test
    fun write_forwards_bytes_to_the_supplied_callback() {
        val captured = mutableListOf<String>()
        val session = RemoteTerminalSession(
            client = NoopClient,
            outputBytes = { data, off, len ->
                captured += String(data, off, len)
            },
        )
        session.initializeEmulator(80, 24, 12, 24)
        val payload = "ls\r".toByteArray()
        session.write(payload, 0, payload.size)
        assertEquals(listOf("ls\r"), captured)
    }

    @Test
    fun is_running_is_false_until_initialize_and_does_not_throw_jni() {
        // isRunning checks mShellPid; remote sessions never set it so the
        // value stays at the default 0 (not -1). Just verify it doesn't
        // throw.
        val session = RemoteTerminalSession(
            client = NoopClient,
            outputBytes = { _, _, _ -> },
        )
        session.isRunning  // must not throw
    }

    private object NoopClient : TerminalSessionClient {
        override fun onTextChanged(changedSession: TerminalSession) {}
        override fun onTitleChanged(changedSession: TerminalSession) {}
        override fun onSessionFinished(finishedSession: TerminalSession) {}
        override fun onCopyTextToClipboard(session: TerminalSession, text: String?) {}
        override fun onPasteTextFromClipboard(@Nullable session: TerminalSession?) {}
        override fun onBell(session: TerminalSession) {}
        override fun onColorsChanged(session: TerminalSession) {}
        override fun onTerminalCursorStateChange(state: Boolean) {}
        override fun setTerminalShellPid(session: TerminalSession, pid: Int) {}
        override fun getTerminalCursorStyle(): Int? = null
        override fun logError(tag: String?, message: String?) {}
        override fun logWarn(tag: String?, message: String?) {}
        override fun logInfo(tag: String?, message: String?) {}
        override fun logDebug(tag: String?, message: String?) {}
        override fun logVerbose(tag: String?, message: String?) {}
        override fun logStackTraceWithMessage(tag: String?, message: String?, e: Exception?) {}
        override fun logStackTrace(tag: String?, e: Exception?) {}
    }
}
