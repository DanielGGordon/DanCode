package com.dancode.terminalcore;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.Arrays;

import org.junit.Test;

import com.termux.terminal.TerminalEmulator;

/**
 * Golden-test suite for the vendored Termux terminal emulator. For each
 * fixture this test:
 *
 *  1. Loads {@code fixtures/<name>.bin} (the recorded byte stream),
 *  2. Loads {@code snapshots/<name>.snap} (the committed expected screen),
 *  3. Constructs a fresh {@link TerminalEmulator} sized
 *     {@link Fixtures#COLS} x {@link Fixtures#ROWS}, feeds the bytes in,
 *  4. Serializes the screen via {@link ScreenSnapshot} and asserts equality
 *     against the committed snapshot.
 *
 * In addition, dedicated tests assert the DECSET/DECRST 1049 and
 * mouse-tracking enter/exit transitions are correctly reflected in
 * {@link TerminalEmulator#isAlternateBufferActive()} and
 * {@link TerminalEmulator#isMouseTrackingActive()}.
 */
public class GoldenFixturesTest {

    @Test
    public void coloredShellMatchesSnapshot() throws IOException {
        assertSnapshotMatches(Fixtures.COLORED_SHELL);
    }

    @Test
    public void vimTuiMatchesSnapshot() throws IOException {
        assertSnapshotMatches(Fixtures.VIM_TUI);
    }

    @Test
    public void claudeAltScreenMatchesSnapshot() throws IOException {
        assertSnapshotMatches(Fixtures.CLAUDE_ALT_SCREEN);
    }

    @Test
    public void claudeMidStreamHasAltScreenAndMouseTrackingActive() throws IOException {
        byte[] bytes = loadFixture(Fixtures.CLAUDE_ALT_SCREEN);
        TerminalEmulator emu = EmulatorDriver.newEmulator(Fixtures.COLS, Fixtures.ROWS);
        EmulatorDriver.feed(emu, Arrays.copyOf(bytes, Fixtures.CLAUDE_MID_STREAM_OFFSET));

        assertTrue("Alt-screen must be active at the mid-stream mark", emu.isAlternateBufferActive());
        assertTrue("Mouse tracking must be active at the mid-stream mark", emu.isMouseTrackingActive());

        String got = ScreenSnapshot.serialize(emu);
        String expected = ScreenSnapshot.loadResource("snapshots/" + Fixtures.CLAUDE_ALT_SCREEN + "-midstream.snap");
        assertEquals("Mid-stream snapshot mismatch (regen via -Dregen.goldens=true)", expected, got);
    }

    @Test
    public void claudeFullStreamRestoresMainScreenAndDisablesMouse() throws IOException {
        byte[] bytes = loadFixture(Fixtures.CLAUDE_ALT_SCREEN);
        TerminalEmulator emu = EmulatorDriver.newEmulator(Fixtures.COLS, Fixtures.ROWS);
        EmulatorDriver.feed(emu, bytes);
        assertFalse("Alt-screen should be exited after DECRST 1049", emu.isAlternateBufferActive());
        assertFalse("Mouse tracking should be disabled after DECRST 1000", emu.isMouseTrackingActive());
    }

    @Test
    public void vimStreamEntersAndExitsAltScreen() throws IOException {
        byte[] bytes = loadFixture(Fixtures.VIM_TUI);

        TerminalEmulator emu = EmulatorDriver.newEmulator(Fixtures.COLS, Fixtures.ROWS);
        // Feed only up to (but not including) the alt-screen exit. The fixture
        // doesn't include an exit (mid-edit screenshot), so the full feed
        // must show alt-screen active.
        EmulatorDriver.feed(emu, bytes);
        assertTrue("vim fixture should leave alt-screen active", emu.isAlternateBufferActive());
        assertFalse("vim fixture doesn't enable mouse tracking", emu.isMouseTrackingActive());

        // Append an explicit DECRST 1049 and re-check.
        EmulatorDriver.feed(emu, "[?1049l");
        assertFalse("After explicit DECRST 1049 alt-screen must be off", emu.isAlternateBufferActive());
    }

    @Test
    public void coloredShellStaysOnMainScreen() throws IOException {
        byte[] bytes = loadFixture(Fixtures.COLORED_SHELL);
        TerminalEmulator emu = EmulatorDriver.newEmulator(Fixtures.COLS, Fixtures.ROWS);
        EmulatorDriver.feed(emu, bytes);
        assertFalse(emu.isAlternateBufferActive());
        assertFalse(emu.isMouseTrackingActive());
    }

    @Test
    public void committedFixtureBytesMatchCanonicalBytes() throws IOException {
        // Defence-in-depth: a bin file on disk that drifted from the byte
        // builder would silently invalidate the snapshot. Catch the drift.
        for (String name : Fixtures.ALL) {
            byte[] expected = Fixtures.bytesFor(name);
            byte[] actual = loadFixture(name);
            assertArrayEquals(
                    "Committed fixture " + name + ".bin must match Fixtures.bytesFor(\"" + name + "\"); "
                            + "regen via -Dregen.goldens=true",
                    expected,
                    actual);
        }
    }

    // -- helpers --

    private void assertSnapshotMatches(String name) throws IOException {
        byte[] bytes = loadFixture(name);
        TerminalEmulator emu = EmulatorDriver.newEmulator(Fixtures.COLS, Fixtures.ROWS);
        EmulatorDriver.feed(emu, bytes);
        String actual = ScreenSnapshot.serialize(emu);
        String expected = ScreenSnapshot.loadResource("snapshots/" + name + ".snap");
        assertEquals(
                "Snapshot mismatch for " + name + " (regen via -Dregen.goldens=true)",
                expected,
                actual);
    }

    private static byte[] loadFixture(String name) throws IOException {
        String path = "fixtures/" + name + ".bin";
        InputStream in = GoldenFixturesTest.class.getClassLoader().getResourceAsStream(path);
        assertNotNull("Missing committed fixture: " + path, in);
        try (InputStream s = in) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[4096];
            int n;
            while ((n = s.read(buf)) > 0) {
                out.write(buf, 0, n);
            }
            return out.toByteArray();
        }
    }
}
