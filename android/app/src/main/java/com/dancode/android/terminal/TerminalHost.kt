package com.dancode.android.terminal

import android.os.Handler
import android.os.Looper
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChange
import androidx.compose.ui.viewinterop.AndroidView
import com.termux.terminal.RemoteTerminalSession
import com.termux.terminal.TerminalSession
import com.termux.terminal.TerminalSessionClient
import com.termux.view.TerminalView
import com.termux.view.TerminalViewClient
import kotlinx.coroutines.delay
import okhttp3.OkHttpClient

/**
 * Composable that owns the production stack for a single live terminal:
 * SocketIoTransport → TerminalConnection → TerminalEmulatorSink →
 * RemoteTerminalSession → TerminalView. The connection-state flow drives
 * [TerminalScreen]'s reconnecting overlay; the AndroidView slot embeds
 * the vendored Termux TerminalView so the actual rendering is reused.
 *
 * Phase 4 additions:
 *  - Polls the emulator state once a frame (~16ms) into a Compose state so
 *    the [InputModePolicy] can flip the input mode when Claude enters /
 *    leaves the alt-screen.
 *  - Pipes the on-screen key-bar taps through `connection.sendRaw`.
 *  - The override-toggle in the header lets the user force a mode.
 *  - A `pointerInput` wrapper around the TerminalView routes two-finger
 *    vertical drags through [ScrollRouter] — SGR wheel bytes inside the
 *    alt-screen, local scroll on the normal screen.
 */
@Composable
fun TerminalHost(
    terminal: TerminalSummary,
    serverBaseUrl: String,
    httpClient: OkHttpClient,
    token: String,
    onBack: () -> Unit,
    fontSizeStore: TerminalFontSizeStore? = null,
) {
    val mainHandler = remember { Handler(Looper.getMainLooper()) }
    val sessionClient = remember { LoggingSessionClient }
    var emuModeState by remember { mutableStateOf(EmulatorModeState(false, false)) }
    val inputModePolicy = remember { InputModePolicy() }
    var manualOverride by remember { mutableStateOf<InputMode?>(null) }
    var fontSizeSp by remember(terminal.id, fontSizeStore) {
        mutableStateOf(fontSizeStore?.read(terminal.id) ?: TerminalFontSizeStore.DEFAULT)
    }
    val pinchDetector = remember { PinchZoomDetector() }

    fun applyFontAction(action: FontSizeAction) {
        fontSizeSp = when (action) {
            FontSizeAction.Increase -> fontSizeStore?.step(terminal.id, +1)
                ?: (fontSizeSp + TerminalFontSizeStore.STEP)
                    .coerceAtMost(TerminalFontSizeStore.MAX)
            FontSizeAction.Decrease -> fontSizeStore?.step(terminal.id, -1)
                ?: (fontSizeSp - TerminalFontSizeStore.STEP)
                    .coerceAtLeast(TerminalFontSizeStore.MIN)
            FontSizeAction.Reset -> {
                fontSizeStore?.reset(terminal.id)
                TerminalFontSizeStore.DEFAULT
            }
        }
    }

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

    // The emulator does not emit a callback when DECSET 1049 / 1000 toggle,
    // so poll. ~60 Hz is more than enough — the bottleneck is the network
    // anyway, and a one-frame lag on mode switching is invisible to a
    // human.
    LaunchedEffect(plumbing) {
        while (true) {
            val emu = plumbing.session.getEmulator()
            if (emu != null) {
                val next = EmulatorModeState(
                    altScreenActive = emu.isAlternateBufferActive,
                    mouseTrackingActive = emu.isMouseTrackingActive,
                )
                if (next != emuModeState) emuModeState = next
            }
            delay(16L)
        }
    }

    val state by plumbing.connection.state.collectAsState()
    val scrollRouter = remember { ScrollRouter() }
    inputModePolicy.let { policy ->
        // Keep the policy's override aligned with the UI state. Read on
        // every recomposition; cheap and avoids a parallel source of
        // truth.
        if (manualOverride == null) policy.clearManualOverride() else policy.setManualOverride(manualOverride!!)
    }
    val inputMode = inputModePolicy.resolve(emuModeState)

    TerminalScreen(
        state = state,
        label = terminal.label,
        onSend = { line -> plumbing.connection.sendLine(line) },
        onBack = onBack,
        inputMode = inputMode,
        manualOverride = manualOverride,
        onKey = { key -> plumbing.connection.sendRaw(key.bytes) },
        onSetManualOverride = { manualOverride = it },
        onFontSizeAction = { applyFontAction(it) },
        terminalContent = {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .pointerInput(Unit) {
                        // Pinch-to-zoom: convert pinch transform events into
                        // font-size actions. Pan / rotate are ignored — they
                        // belong to the two-finger drag handler below.
                        detectTransformGestures { _, _, zoom, _ ->
                            if (zoom != 1f) {
                                pinchDetector.onScale(zoom)?.let { applyFontAction(it) }
                            }
                        }
                    }
                    .pointerInput(plumbing, emuModeState) {
                        // Two-finger vertical drag routing. Runs at Initial
                        // pass so the gesture can be inspected before the
                        // child TerminalView consumes it for selection /
                        // single-finger scroll.
                        awaitPointerEventScope {
                            var accumulated = 0f
                            while (true) {
                                val ev = awaitPointerEvent(PointerEventPass.Initial)
                                val active = ev.changes.filter { it.pressed }
                                if (active.size < 2) {
                                    accumulated = 0f
                                    continue
                                }
                                val dy = active.map { it.positionChange().y }.average().toFloat()
                                accumulated += dy
                                val cellPx = 32f  // conservative; precise value pulled from renderer at runtime
                                val deltaRows = (accumulated / cellPx).toInt()
                                if (deltaRows != 0) {
                                    accumulated -= deltaRows * cellPx
                                    val emu = plumbing.session.getEmulator()
                                    val cursorCol = (emu?.cursorCol ?: 0) + 1
                                    val cursorRow = (emu?.cursorRow ?: 0) + 1
                                    val action = scrollRouter.onTwoFingerDrag(
                                        deltaRows = deltaRows,
                                        cursorCol = cursorCol,
                                        cursorRow = cursorRow,
                                        state = emuModeState,
                                    )
                                    when (action) {
                                        is ScrollAction.SendBytes -> {
                                            plumbing.connection.sendRaw(action.bytes)
                                            active.forEach { it.consume() }
                                        }
                                        is ScrollAction.LocalScroll -> {
                                            // Termux's own GestureRecognizer
                                            // handles single-finger scroll;
                                            // for two-finger we let the
                                            // event fall through so the
                                            // recogniser performs the local
                                            // scroll on the wrapped view.
                                        }
                                        ScrollAction.None -> {}
                                    }
                                }
                            }
                        }
                    },
            ) {
                val lastAppliedFontSize = remember { mutableStateOf(-1) }
                AndroidView(
                    modifier = Modifier.fillMaxSize(),
                    factory = { ctx ->
                        TerminalView(ctx, /* attributes */ null).also { tv ->
                            tv.setTerminalViewClient(NoopTerminalViewClient)
                            tv.attachSession(plumbing.session)
                        }
                    },
                    update = { tv ->
                        val dp = tv.resources.displayMetrics.density
                        val targetPx = (fontSizeSp * dp).toInt().coerceAtLeast(8)
                        if (lastAppliedFontSize.value != targetPx) {
                            tv.setTextSize(targetPx)
                            lastAppliedFontSize.value = targetPx
                        }
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
            }
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
    override fun onKeyDown(keyCode: Int, e: android.view.KeyEvent?, session: TerminalSession?): Boolean = false
    override fun onKeyUp(keyCode: Int, e: android.view.KeyEvent?): Boolean = false
    override fun onLongPress(event: android.view.MotionEvent?): Boolean = false
    override fun readControlKey(): Boolean = false
    override fun readAltKey(): Boolean = false
    override fun readShiftKey(): Boolean = false
    override fun readFnKey(): Boolean = false
    override fun onCodePoint(codePoint: Int, ctrlDown: Boolean, session: TerminalSession?): Boolean = false
    override fun onEmulatorSet() {}
    override fun logError(tag: String?, message: String?) {}
    override fun logWarn(tag: String?, message: String?) {}
    override fun logInfo(tag: String?, message: String?) {}
    override fun logDebug(tag: String?, message: String?) {}
    override fun logVerbose(tag: String?, message: String?) {}
    override fun logStackTraceWithMessage(tag: String?, message: String?, e: Exception?) {}
    override fun logStackTrace(tag: String?, e: Exception?) {}
}

private object LoggingSessionClient : TerminalSessionClient {
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
    override fun logStackTraceWithMessage(tag: String?, message: String?, e: Exception?) {}
    override fun logStackTrace(tag: String?, e: Exception?) {}
}
