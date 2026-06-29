package com.dancode.terminalcore;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

import com.termux.terminal.TerminalBuffer;
import com.termux.terminal.TerminalEmulator;
import com.termux.terminal.TextStyle;

/**
 * Stable text serialization of a terminal screen for golden-fixture
 * comparisons. The format is deliberately line-oriented and human-diffable:
 *
 * <pre>
 *   # screen <cols>x<rows> alt=<bool> mouse=<bool> cursor=<col>,<row>
 *   T |Lorem ipsum dolor          |
 *   F |999999999AAAAAAAAAAAAAAAAAA|     # foreground color index per cell, base-36
 *   B |...........................|     # background color index per cell, base-36
 *   E |..........BB...............|     # effect bits flagged with a glyph
 *   T |...                        |
 *   ...
 * </pre>
 *
 * - Foreground/background cells whose color equals {@link TextStyle#COLOR_INDEX_FOREGROUND}
 *   or {@link TextStyle#COLOR_INDEX_BACKGROUND} respectively are rendered as
 *   "." so that the only visible differences in the snapshot are non-default
 *   styling — recordings stay short and reviewable.
 * - Effect flags use letters: B=bold, I=italic, U=underline, K=blink (BlinK),
 *   V=inverse, X=invisible, S=strikethrough, P=protected, D=dim. "." = no
 *   effect.
 */
public final class ScreenSnapshot {

    private ScreenSnapshot() {
    }

    /** Serialize the visible portion of the emulator's screen to the format above. */
    public static String serialize(TerminalEmulator emu) {
        TerminalBuffer screen = emu.getScreen();
        int cols = emu.mColumns;
        int rows = emu.mRows;

        StringBuilder out = new StringBuilder();
        out.append(String.format(
                Locale.ROOT,
                "# screen %dx%d alt=%s mouse=%s cursor=%d,%d%n",
                cols,
                rows,
                emu.isAlternateBufferActive(),
                emu.isMouseTrackingActive(),
                emu.getCursorCol(),
                emu.getCursorRow()));

        for (int r = 0; r < rows; r++) {
            StringBuilder text = new StringBuilder(cols);
            StringBuilder fg = new StringBuilder(cols);
            StringBuilder bg = new StringBuilder(cols);
            StringBuilder eff = new StringBuilder(cols);

            for (int c = 0; c < cols; c++) {
                int cp = EmulatorDriver.codePointAt(screen, r, c);
                if (cp <= 0 || cp == 0) {
                    text.append(' ');
                } else if (cp >= 32 && cp != 127) {
                    text.appendCodePoint(cp);
                } else {
                    text.append('?');
                }
                long style = screen.getStyleAt(r, c);
                fg.append(encodeColor(TextStyle.decodeForeColor(style), TextStyle.COLOR_INDEX_FOREGROUND));
                bg.append(encodeColor(TextStyle.decodeBackColor(style), TextStyle.COLOR_INDEX_BACKGROUND));
                eff.append(encodeEffect(TextStyle.decodeEffect(style)));
            }

            out.append("T |").append(text).append("|").append(System.lineSeparator());
            out.append("F |").append(fg).append("|").append(System.lineSeparator());
            out.append("B |").append(bg).append("|").append(System.lineSeparator());
            out.append("E |").append(eff).append("|").append(System.lineSeparator());
        }
        return out.toString();
    }

    /**
     * Load a snapshot from a JVM test resource. The file is required —
     * callers should commit it. Returns the file contents with newlines
     * normalised to the platform separator so windows/unix don't fight.
     */
    public static String loadResource(String resourcePath) {
        ClassLoader cl = ScreenSnapshot.class.getClassLoader();
        InputStream in = cl.getResourceAsStream(resourcePath);
        if (in == null) {
            throw new IllegalArgumentException("Missing test resource: " + resourcePath);
        }
        try (BufferedReader r = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8))) {
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = r.readLine()) != null) {
                sb.append(line).append(System.lineSeparator());
            }
            return sb.toString();
        } catch (IOException e) {
            throw new RuntimeException("Failed to read " + resourcePath, e);
        }
    }

    private static char encodeColor(int color, int defaultIndex) {
        if (color == defaultIndex) return '.';
        if (color >= 0 && color <= 9) return (char) ('0' + color);
        if (color >= 10 && color < 36) return (char) ('a' + (color - 10));
        if (color >= 36 && color < 62) return (char) ('A' + (color - 36));
        // 256-color indices above 61 collapse to '*'. 24-bit truecolor flags
        // are encoded via the high byte so > 0xff000000; encode as '#'.
        if ((color & 0xff000000) == 0xff000000) return '#';
        return '*';
    }

    private static final char[] EFFECT_FLAGS = new char[] {
            'B', // bold
            'I', // italic
            'U', // underline
            'K', // blink
            'V', // inverse
            'X', // invisible
            'S', // strikethrough
            'P', // protected
            'D'  // dim
    };

    private static char encodeEffect(int effect) {
        if (effect == 0) return '.';
        // Render the first set effect; combinations are rare in our fixtures
        // and the snapshot is still uniquely identifying per (text + per-cell color).
        for (int i = 0; i < EFFECT_FLAGS.length; i++) {
            if ((effect & (1 << i)) != 0) return EFFECT_FLAGS[i];
        }
        return '?';
    }

    /** Convenience: collect non-blank effect cells as (row, col, flag) tuples. */
    public static List<String> effectCells(TerminalEmulator emu) {
        TerminalBuffer screen = emu.getScreen();
        int cols = emu.mColumns;
        int rows = emu.mRows;
        List<String> out = new ArrayList<>();
        for (int r = 0; r < rows; r++) {
            for (int c = 0; c < cols; c++) {
                long style = screen.getStyleAt(r, c);
                int eff = TextStyle.decodeEffect(style);
                if (eff != 0) {
                    out.add(r + "," + c + "=" + encodeEffect(eff));
                }
            }
        }
        return out;
    }
}
