package com.dancode.android.terminal

/**
 * Encodes Compose text-field input as the byte sequence the shell expects.
 *
 * Cooked-mode is the Phase 3 default: each Send press emits exactly one
 * trailing carriage return regardless of whether the user typed `\n` /
 * `\r` / `\r\n` in the field. Phase 4 will add raw-mode passthrough.
 */
object TerminalInputEncoder {

    fun cookedLine(line: String): String {
        var end = line.length
        while (end > 0 && (line[end - 1] == '\n' || line[end - 1] == '\r')) {
            end--
        }
        return line.substring(0, end) + "\r"
    }
}
