package com.dancode.android.terminal

/**
 * Control keys surfaced by the on-screen key bar.
 *
 * Each entry carries:
 *  - A short [label] for the button UI (so the row stays compact).
 *  - The exact [bytes] string the terminal expects. These are the
 *    VT100/xterm sequences Claude Code reads — diverging silently would
 *    break interrupt, menu nav, or completion across the entire app.
 *
 * The encoder lives next to the enum on purpose: production code that
 * needs the byte sequence reaches for `ControlKey.X.bytes`, never a
 * hand-rolled string, so the same constants drive the UI, the wire layer,
 * and the golden tests.
 */
enum class ControlKey(val label: String, val bytes: String) {
    Esc("Esc", ""),
    ArrowUp("↑", "[A"),
    ArrowDown("↓", "[B"),
    ArrowLeft("←", "[D"),
    ArrowRight("→", "[C"),
    Enter("Enter", "\r"),
    CtrlC("Ctrl+C", ""),
    Tab("Tab", "\t"),
    ShiftTab("Shift+Tab", "[Z");
}
