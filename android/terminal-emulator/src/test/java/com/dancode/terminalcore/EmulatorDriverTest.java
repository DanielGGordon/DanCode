package com.dancode.terminalcore;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;

import org.junit.Test;

import com.termux.terminal.TerminalEmulator;

/**
 * Sanity checks for {@link EmulatorDriver} — the test-only helper that wraps
 * a {@link TerminalEmulator} for headless byte-stream playback. The full
 * golden-fixture suite lives in {@link GoldenFixturesTest}.
 */
public class EmulatorDriverTest {

    @Test
    public void plainAsciiAppearsOnFirstRow() {
        TerminalEmulator emu = EmulatorDriver.newEmulator(20, 5);
        EmulatorDriver.feed(emu, "hello");
        assertEquals("hello               ", EmulatorDriver.row(emu, 0));
    }

    @Test
    public void freshEmulatorIsOnMainScreen() {
        TerminalEmulator emu = EmulatorDriver.newEmulator(20, 5);
        assertFalse(emu.isAlternateBufferActive());
        assertFalse(emu.isMouseTrackingActive());
    }
}
