package com.dancode.android.terminal

import android.content.Context
import android.content.SharedPreferences

/**
 * Per-terminal font-size persistence. Keys are namespaced by terminal id
 * (the server-issued UUID) so swapping between terminals restores each
 * one's last-chosen size. Values are clamped on write so a corrupted
 * preference file can never push the renderer outside a usable range.
 *
 * Backing store is a plain [SharedPreferences] — font size isn't sensitive
 * data and writing on every step is cheap.
 */
class TerminalFontSizeStore internal constructor(private val prefs: SharedPreferences) {

    fun read(terminalId: String): Int {
        val raw = prefs.getInt(key(terminalId), DEFAULT)
        return clamp(raw)
    }

    fun save(terminalId: String, sizeSp: Int) {
        prefs.edit().putInt(key(terminalId), clamp(sizeSp)).apply()
    }

    /** Reset to the bundled default. */
    fun reset(terminalId: String) {
        prefs.edit().remove(key(terminalId)).apply()
    }

    /**
     * Mutate the persisted size by [stepsSign] * [STEP] and return the new
     * value. A separate method (rather than read + save in the caller)
     * keeps clamping + persistence atomic.
     */
    fun step(terminalId: String, stepsSign: Int): Int {
        val next = clamp(read(terminalId) + stepsSign * STEP)
        prefs.edit().putInt(key(terminalId), next).apply()
        return next
    }

    private fun key(terminalId: String) = "$KEY_PREFIX$terminalId"
    private fun clamp(sizeSp: Int): Int = sizeSp.coerceIn(MIN, MAX)

    companion object {
        const val PREFS_FILE = "dancode-terminal-font-prefs"
        private const val KEY_PREFIX = "font_sp:"
        const val DEFAULT = 14
        const val MIN = 8
        const val MAX = 40
        const val STEP = 2

        fun create(context: Context, prefsFileName: String = PREFS_FILE): TerminalFontSizeStore {
            val prefs = context.getSharedPreferences(prefsFileName, Context.MODE_PRIVATE)
            return TerminalFontSizeStore(prefs)
        }
    }
}
