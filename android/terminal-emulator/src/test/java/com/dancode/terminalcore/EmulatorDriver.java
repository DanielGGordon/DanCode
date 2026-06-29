package com.dancode.terminalcore;

import java.nio.charset.StandardCharsets;

import com.termux.terminal.TerminalBuffer;
import com.termux.terminal.TerminalEmulator;
import com.termux.terminal.TerminalOutput;

/**
 * Test-only helper that constructs a {@link TerminalEmulator} with a no-op
 * {@link TerminalOutput} and a null {@code TerminalSessionClient}, then
 * exposes simple byte-stream playback + per-row text accessors so tests can
 * read out the screen buffer without touching Android UI classes.
 *
 * <p>This is the pure-JVM seam: no JNI, no Android resources, no surface.
 */
public final class EmulatorDriver {

    private EmulatorDriver() {
    }

    /** Construct a fresh emulator sized {@code columns x rows} with no transcript noise. */
    public static TerminalEmulator newEmulator(int columns, int rows) {
        return new TerminalEmulator(
                NULL_OUTPUT,
                columns,
                rows,
                /* cellWidthPixels */ 12,
                /* cellHeightPixels */ 24,
                /* transcriptRows */ TerminalEmulator.TERMINAL_TRANSCRIPT_ROWS_MIN,
                /* client */ null);
    }

    /** Feed a UTF-8 string into the emulator as if it had arrived from the PTY. */
    public static void feed(TerminalEmulator emu, String data) {
        feed(emu, data.getBytes(StandardCharsets.UTF_8));
    }

    /** Feed raw bytes into the emulator as if they had arrived from the PTY. */
    public static void feed(TerminalEmulator emu, byte[] data) {
        emu.append(data, data.length);
    }

    /**
     * Return the current visible content of row {@code externalRow} as a plain
     * string of length {@code columns}, padding with spaces. Trailing
     * not-yet-written cells appear as {@code ' '} — that matches what xterm
     * shows for an unwritten column.
     */
    public static String row(TerminalEmulator emu, int externalRow) {
        TerminalBuffer screen = emu.getScreen();
        StringBuilder sb = new StringBuilder(emu.mColumns);
        for (int col = 0; col < emu.mColumns; col++) {
            int cp = codePointAt(screen, externalRow, col);
            if (cp <= 0) {
                sb.append(' ');
            } else {
                sb.appendCodePoint(cp);
            }
        }
        return sb.toString();
    }

    /**
     * Read the Unicode code point at (externalRow, col) by parsing the row's
     * packed UTF-16 buffer. Returns {@code -1} for cells that were never
     * written (TerminalRow leaves them at {@code '\0'} after the constructor
     * fills the row with spaces, so we treat both as blank).
     */
    static int codePointAt(TerminalBuffer screen, int externalRow, int col) {
        com.termux.terminal.TerminalRow row = screen.allocateFullLineIfNecessary(screen.externalToInternalRow(externalRow));
        int idx = row.findStartOfColumn(col);
        char first = row.mText[idx];
        if (Character.isHighSurrogate(first) && idx + 1 < row.mText.length) {
            return Character.toCodePoint(first, row.mText[idx + 1]);
        }
        return first;
    }

    private static final TerminalOutput NULL_OUTPUT = new TerminalOutput() {
        @Override
        public void write(byte[] data, int offset, int count) {
        }

        @Override
        public void titleChanged(String oldTitle, String newTitle) {
        }

        @Override
        public void onCopyTextToClipboard(String text) {
        }

        @Override
        public void onPasteTextFromClipboard() {
        }

        @Override
        public void onBell() {
        }

        @Override
        public void onColorsChanged() {
        }
    };
}
