package com.dancode.android.terminal

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Golden byte sequences for each control key surfaced in the key bar.
 *
 * Each sequence is asserted as a `String` of literal bytes so a diff in
 * the production encoder is impossible to miss. The values mirror the
 * VT100/xterm conventions exercised by Claude Code:
 *  - Esc                : 0x1b
 *  - Arrow Up           : ESC `[A`
 *  - Arrow Down         : ESC `[B`
 *  - Arrow Right        : ESC `[C`
 *  - Arrow Left         : ESC `[D`
 *  - Enter (Return)     : 0x0d
 *  - Ctrl+C (SIGINT)    : 0x03
 *  - Tab                : 0x09
 *  - Shift+Tab          : ESC `[Z`  (cursor back tab)
 */
class ControlKeyTest {

    private val ESC = ""

    @Test fun esc() { assertEquals(ESC, ControlKey.Esc.bytes) }

    @Test fun arrow_up()    { assertEquals("$ESC[A", ControlKey.ArrowUp.bytes) }
    @Test fun arrow_down()  { assertEquals("$ESC[B", ControlKey.ArrowDown.bytes) }
    @Test fun arrow_right() { assertEquals("$ESC[C", ControlKey.ArrowRight.bytes) }
    @Test fun arrow_left()  { assertEquals("$ESC[D", ControlKey.ArrowLeft.bytes) }

    @Test fun enter()  { assertEquals("\r", ControlKey.Enter.bytes) }
    @Test fun ctrl_c() { assertEquals("", ControlKey.CtrlC.bytes) }
    @Test fun tab()    { assertEquals("\t", ControlKey.Tab.bytes) }
    @Test fun shift_tab() { assertEquals("$ESC[Z", ControlKey.ShiftTab.bytes) }

    /** Each entry must be uniquely identifiable for the UI to render them. */
    @Test fun labels_are_unique_and_non_blank() {
        val labels = ControlKey.entries.map { it.label }
        assertEquals(labels.size, labels.distinct().size)
        labels.forEach { assertEquals(it, it.trim()) }
        labels.forEach { assert(it.isNotEmpty()) { "label was blank" } }
    }
}
