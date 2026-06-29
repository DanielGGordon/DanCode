package com.dancode.terminalcore;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;

/**
 * Canonical byte sequences for the golden-test fixtures. Each {@code byte[]}
 * is a hand-stitched recording of a typical real-world ANSI stream — a
 * miniature reproduction of what the wire bytes would look like, sized to
 * fit a small {@code COLS x ROWS} screen so the snapshots stay reviewable.
 *
 * <p>The same bytes are written to {@code src/test/resources/fixtures/*.bin}
 * by {@link RegenerateGoldens}, so the committed binaries always match the
 * code that interprets them — drift between the two would surface as the
 * tests in {@link GoldenFixturesTest} flipping red on the next run.
 */
public final class Fixtures {

    public static final int COLS = 40;
    public static final int ROWS = 8;

    public static final String COLORED_SHELL = "colored-shell";
    public static final String VIM_TUI = "vim-tui";
    public static final String CLAUDE_ALT_SCREEN = "claude-altscreen";

    public static final String[] ALL = new String[] {
            COLORED_SHELL,
            VIM_TUI,
            CLAUDE_ALT_SCREEN,
    };

    private Fixtures() {
    }

    public static byte[] bytesFor(String name) {
        switch (name) {
            case COLORED_SHELL: return coloredShell();
            case VIM_TUI: return vimTui();
            case CLAUDE_ALT_SCREEN: return claudeAltScreen();
            default: throw new IllegalArgumentException("Unknown fixture: " + name);
        }
    }

    private static final String ESC = "";
    private static final String CSI = ESC + "[";

    /**
     * Plain shell with {@code ls --color=auto} style output: bold blue
     * directory, bold green executable, plain file, bold red broken
     * symlink, then a fresh {@code $} prompt. Exercises SGR colors,
     * bold attribute, line-wrap-free output. The emulator stays on
     * the main screen the whole time; alt-screen + mouse-tracking
     * must remain false.
     */
    private static byte[] coloredShell() {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        // Prompt + typed command (echoed).
        write(out, "$ ls --color=auto\r\n");
        // First line: bold blue dir, bold green exec, plain file (separated by spaces).
        write(out, CSI + "01;34m" + "dir1" + CSI + "0m" + "  ");
        write(out, CSI + "01;32m" + "exec" + CSI + "0m" + "  ");
        write(out, "file.txt" + "  ");
        write(out, CSI + "01;31m" + "broken" + CSI + "0m");
        write(out, "\r\n");
        // Second line: a couple more, then return to prompt.
        write(out, CSI + "01;34m" + "src" + CSI + "0m" + "  ");
        write(out, "README.md" + "\r\n");
        write(out, "$ ");
        return out.toByteArray();
    }

    /**
     * Minimal vim-shaped recording: enters alt-screen via DECSET 1049,
     * clears, draws four {@code ~} lines (a fresh buffer), then writes the
     * status bar {@code -- INSERT --} in inverse video on the last row, and
     * finally leaves alt-screen via DECRST 1049. After exit the main screen
     * should be restored intact and alt-screen state must be {@code false}.
     */
    private static byte[] vimTui() {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        // Pre-alt: shell prompt with prior history.
        write(out, "$ vim file.txt\r\n");
        // Enter alt-screen (xterm extension, saves cursor + clears alt).
        write(out, CSI + "?1049h");
        // Move to top-left, clear screen.
        write(out, CSI + "H" + CSI + "2J");
        // Draw 4 empty buffer lines with leading "~".
        for (int i = 0; i < 4; i++) {
            write(out, "~\r\n");
        }
        // One blank line, then the status bar in inverse video on row 7 (0-indexed 6).
        write(out, CSI + "7;1H"); // row 7, col 1
        write(out, CSI + "7m" + "-- INSERT --" + CSI + "0m");
        // Cursor parked at row 1, col 1 (inside the buffer).
        write(out, CSI + "1;1H");
        return out.toByteArray();
    }

    /**
     * Claude Code-style alt-screen with mouse tracking enabled. The
     * sequence:
     *   1. enters alt-screen (DECSET 1049),
     *   2. enables SGR mouse tracking (DECSET 1000 + 1006) — Claude's TUI
     *      uses this to drive its own scroll wheel handling,
     *   3. draws a simple frame and prompt,
     *   4. then leaves: disables mouse (DECRST 1000/1006) and alt-screen
     *      (DECRST 1049).
     * Within the stream, mid-recording state must be {@code alt=true},
     * {@code mouse=true}; the test that consumes only the first half of
     * the stream asserts that, and the test that consumes the whole stream
     * asserts the post-exit state is back to {@code false,false}.
     */
    private static byte[] claudeAltScreen() {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        // Pre-alt: short shell line.
        write(out, "$ claude\r\n");
        // Enter alt-screen.
        write(out, CSI + "?1049h");
        // Hide cursor (Claude's TUI hides while rendering).
        write(out, CSI + "?25l");
        // Enable mouse tracking (X10 button-press) + SGR encoding.
        write(out, CSI + "?1000h");
        write(out, CSI + "?1006h");
        // Clear + draw frame.
        write(out, CSI + "H" + CSI + "2J");
        write(out, "+--------------------------------------+\r\n");
        write(out, "| Welcome to Claude Code               |\r\n");
        write(out, "|                                      |\r\n");
        write(out, "| > Try \"how do I print hello world?\" |\r\n");
        write(out, "|                                      |\r\n");
        write(out, "+--------------------------------------+\r\n");
        // ----- mid-recording marker -----
        // Cursor inside the input row.
        write(out, CSI + "4;5H");
        // Now exit.
        write(out, CSI + "?1006l");
        write(out, CSI + "?1000l");
        write(out, CSI + "?25h");
        write(out, CSI + "?1049l");
        return out.toByteArray();
    }

    /**
     * Mid-stream offset for {@link #CLAUDE_ALT_SCREEN}: number of bytes
     * from the start up to but not including the first {@code CSI ?1006l}
     * (the disable-mouse sequence). Tests use this to inspect state at the
     * peak of TUI activity, before exit. Computed at class-load time so any
     * edit to {@link #claudeAltScreen()} stays in sync.
     */
    public static final int CLAUDE_MID_STREAM_OFFSET;
    static {
        byte[] bytes = claudeAltScreen();
        // CSI ?1006l = ESC [ ? 1 0 0 6 l
        byte[] marker = (ESC + "[?1006l").getBytes(StandardCharsets.UTF_8);
        int found = -1;
        outer:
        for (int i = 0; i + marker.length <= bytes.length; i++) {
            for (int j = 0; j < marker.length; j++) {
                if (bytes[i + j] != marker[j]) continue outer;
            }
            found = i;
            break;
        }
        if (found < 0) throw new IllegalStateException("CSI ?1006l marker not found in claudeAltScreen()");
        CLAUDE_MID_STREAM_OFFSET = found;
    }

    private static void write(ByteArrayOutputStream out, String s) {
        byte[] b = s.getBytes(StandardCharsets.UTF_8);
        out.write(b, 0, b.length);
    }
}
