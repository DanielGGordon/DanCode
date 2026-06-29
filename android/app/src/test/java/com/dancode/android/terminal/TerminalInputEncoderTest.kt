package com.dancode.android.terminal

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Cooked-mode encoding: a typed line plus a single trailing carriage
 * return. The Compose input field strips trailing newlines on Send so the
 * encoder is responsible for the `\r` terminator.
 */
class TerminalInputEncoderTest {

    @Test
    fun appends_carriage_return_to_plain_line() {
        assertEquals("ls\r", TerminalInputEncoder.cookedLine("ls"))
    }

    @Test
    fun preserves_embedded_whitespace_and_appends_only_one_cr() {
        assertEquals("echo  hi\r", TerminalInputEncoder.cookedLine("echo  hi"))
    }

    @Test
    fun strips_any_trailing_lf_or_cr_before_appending_cr() {
        assertEquals("ls\r", TerminalInputEncoder.cookedLine("ls\n"))
        assertEquals("ls\r", TerminalInputEncoder.cookedLine("ls\r\n"))
        assertEquals("ls\r", TerminalInputEncoder.cookedLine("ls\r"))
    }

    @Test
    fun empty_line_still_sends_only_cr() {
        assertEquals("\r", TerminalInputEncoder.cookedLine(""))
    }
}
