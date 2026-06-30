package com.termux.terminal

/**
 * A [TerminalSession] whose PTY lives on the server — bytes the emulator
 * would have written to a local file descriptor are forwarded via
 * [outputBytes] instead (the production path wires that to the socket.io
 * `input` event).
 *
 * `initializeEmulator()` is overridden to skip Termux's
 * `JNI.createSubprocess`; everything else (the emulator, the screen
 * buffer, the `TerminalView` consumption path) is reused as-is.
 *
 * This class lives in `com.termux.terminal` so it can see the
 * package-private fields (`mEmulator`, `mClient`, …) on the parent.
 */
class RemoteTerminalSession(
    client: TerminalSessionClient,
    private val outputBytes: (ByteArray, Int, Int) -> Unit,
) : TerminalSession(
    /* shellPath */ "",
    /* cwd */ "",
    /* args */ emptyArray(),
    /* env */ emptyArray(),
    /* transcriptRows */ TerminalEmulator.TERMINAL_TRANSCRIPT_ROWS_MIN,
    /* client */ client,
) {

    override fun initializeEmulator(
        columns: Int,
        rows: Int,
        cellWidthPixels: Int,
        cellHeightPixels: Int,
    ) {
        mEmulator = TerminalEmulator(
            this,
            columns,
            rows,
            cellWidthPixels,
            cellHeightPixels,
            TerminalEmulator.TERMINAL_TRANSCRIPT_ROWS_MIN,
            mClient,
        )
    }

    override fun write(data: ByteArray, offset: Int, count: Int) {
        outputBytes(data, offset, count)
    }

    /**
     * Resize the local emulator only. The parent's [TerminalSession.updateSize]
     * calls `JNI.setPtyWindowSize` once the emulator exists, which triggers
     * `System.loadLibrary("termux")` — but there is no local PTY (and no
     * bundled native lib), so that throws `UnsatisfiedLinkError` and crashes
     * the app the moment the view re-lays-out. The server-side PTY is resized
     * separately via the socket.io `resize` event, so we never touch JNI here.
     */
    override fun updateSize(
        columns: Int,
        rows: Int,
        cellWidthPixels: Int,
        cellHeightPixels: Int,
    ) {
        val emulator = mEmulator
        if (emulator == null) {
            initializeEmulator(columns, rows, cellWidthPixels, cellHeightPixels)
        } else {
            emulator.resize(columns, rows, cellWidthPixels, cellHeightPixels)
        }
    }
}
