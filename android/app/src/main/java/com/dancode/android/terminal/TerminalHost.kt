package com.dancode.android.terminal

import android.os.Handler
import android.os.Looper
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import com.termux.terminal.RemoteTerminalSession
import com.termux.view.TerminalView
import com.termux.view.TerminalViewClient
import okhttp3.OkHttpClient

/**
 * Composable that owns the production stack for a single live terminal:
 * SocketIoTransport → TerminalConnection → TerminalEmulatorSink →
 * RemoteTerminalSession → TerminalView. The connection-state flow drives
 * [TerminalScreen]'s reconnecting overlay; the AndroidView slot embeds
 * the vendored Termux TerminalView so the actual rendering is reused.
 */
@Composable
fun TerminalHost(
    terminal: TerminalSummary,
    serverBaseUrl: String,
    httpClient: OkHttpClient,
    token: String,
    onBack: () -> Unit,
) {
    val mainHandler = remember { Handler(Looper.getMainLooper()) }
    val sessionClient = remember { LoggingSessionClient }

    // Lazy-built so DisposableEffect can stop() cleanly when the screen
    // leaves the composition.
    val plumbing = remember(terminal.id, serverBaseUrl, token) {
        val transport = SocketIoTransport(baseUrl = serverBaseUrl, httpClient = httpClient)
        val session = RemoteTerminalSession(
            client = sessionClient,
            outputBytes = { data, offset, count ->
                val slice = if (offset == 0 && count == data.size) String(data, Charsets.UTF_8)
                    else String(data, offset, count, Charsets.UTF_8)
                transport.sendInput(slice)
            },
        )
        val sink = MainThreadSink(TerminalEmulatorSink(session), mainHandler)
        val connection = TerminalConnection(
            transport = transport,
            sink = sink,
            namespace = "/terminal/${terminal.id}",
            token = token,
        )
        Plumbing(transport = transport, session = session, connection = connection)
    }

    DisposableEffect(plumbing) {
        plumbing.connection.start()
        onDispose { plumbing.connection.stop() }
    }

    val state by plumbing.connection.state.collectAsState()

    TerminalScreen(
        state = state,
        label = terminal.label,
        onSend = { line -> plumbing.connection.sendLine(line) },
        onBack = onBack,
        terminalContent = {
            AndroidView(
                modifier = Modifier,
                factory = { ctx ->
                    TerminalView(ctx, /* attributes */ null).also { tv ->
                        tv.setTerminalViewClient(NoopTerminalViewClient)
                        tv.attachSession(plumbing.session)
                    }
                },
                update = { tv ->
                    // Each layout pass emits a resize derived from the
                    // current pixel size and the renderer's font cell.
                    // The renderer is the source of truth at runtime;
                    // TerminalViewMetrics still applies the floor +
                    // min-one-by-one rules.
                    val renderer = tv.mRenderer
                    val cellWidth = renderer?.fontWidth ?: 12f
                    val cellHeight = (renderer?.fontLineSpacing ?: 24).toFloat()
                    val (cols, rowsCount) = TerminalViewMetrics.gridDimensions(
                        viewWidthPx = tv.width.coerceAtLeast(0),
                        viewHeightPx = tv.height.coerceAtLeast(0),
                        cellWidthPx = cellWidth,
                        cellHeightPx = cellHeight,
                    )
                    if (cols > 0 && rowsCount > 0) {
                        plumbing.connection.sendResize(cols, rowsCount)
                        if (plumbing.session.getEmulator() == null) {
                            plumbing.session.updateSize(
                                cols,
                                rowsCount,
                                cellWidth.toInt(),
                                cellHeight.toInt(),
                            )
                        }
                    }
                },
            )
        },
    )
}

/** Marshalls sink calls onto the main thread; the emulator is not thread-safe. */
private class MainThreadSink(
    private val delegate: TerminalSink,
    private val handler: Handler,
) : TerminalSink {
    override fun write(data: String) { handler.post { delegate.write(data) } }
    override fun reset() { handler.post { delegate.reset() } }
}

private data class Plumbing(
    val transport: SocketIoTransport,
    val session: RemoteTerminalSession,
    val connection: TerminalConnection,
)

private object NoopTerminalViewClient : TerminalViewClient {
    override fun onScale(scale: Float): Float = scale
    override fun onSingleTapUp(e: android.view.MotionEvent?) {}
    override fun shouldBackButtonBeMappedToEscape(): Boolean = false
    override fun shouldEnforceCharBasedInput(): Boolean = false
    override fun shouldUseCtrlSpaceWorkaround(): Boolean = false
    override fun isTerminalViewSelected(): Boolean = true
    override fun copyModeChanged(copyMode: Boolean) {}
    override fun onKeyDown(keyCode: Int, e: android.view.KeyEvent?, session: com.termux.terminal.TerminalSession?): Boolean = false
    override fun onKeyUp(keyCode: Int, e: android.view.KeyEvent?): Boolean = false
    override fun onLongPress(event: android.view.MotionEvent?): Boolean = false
    override fun readControlKey(): Boolean = false
    override fun readAltKey(): Boolean = false
    override fun readShiftKey(): Boolean = false
    override fun readFnKey(): Boolean = false
    override fun onCodePoint(codePoint: Int, ctrlDown: Boolean, session: com.termux.terminal.TerminalSession?): Boolean = false
    override fun onEmulatorSet() {}
    override fun logError(tag: String?, message: String?) {}
    override fun logWarn(tag: String?, message: String?) {}
    override fun logInfo(tag: String?, message: String?) {}
    override fun logDebug(tag: String?, message: String?) {}
    override fun logVerbose(tag: String?, message: String?) {}
    override fun logStackTraceWithMessage(tag: String?, message: String?, e: Exception?) {}
    override fun logStackTrace(tag: String?, e: Exception?) {}
}

private object LoggingSessionClient : com.termux.terminal.TerminalSessionClient {
    override fun onTextChanged(s: com.termux.terminal.TerminalSession) {}
    override fun onTitleChanged(s: com.termux.terminal.TerminalSession) {}
    override fun onSessionFinished(s: com.termux.terminal.TerminalSession) {}
    override fun onCopyTextToClipboard(s: com.termux.terminal.TerminalSession, t: String?) {}
    override fun onPasteTextFromClipboard(s: com.termux.terminal.TerminalSession?) {}
    override fun onBell(s: com.termux.terminal.TerminalSession) {}
    override fun onColorsChanged(s: com.termux.terminal.TerminalSession) {}
    override fun onTerminalCursorStateChange(state: Boolean) {}
    override fun setTerminalShellPid(s: com.termux.terminal.TerminalSession, pid: Int) {}
    override fun getTerminalCursorStyle(): Int? = null
    override fun logError(tag: String?, message: String?) {}
    override fun logWarn(tag: String?, message: String?) {}
    override fun logInfo(tag: String?, message: String?) {}
    override fun logDebug(tag: String?, message: String?) {}
    override fun logVerbose(tag: String?, message: String?) {}
    override fun logStackTraceWithMessage(tag: String?, message: String?, e: Exception?) {}
    override fun logStackTrace(tag: String?, e: Exception?) {}
}
