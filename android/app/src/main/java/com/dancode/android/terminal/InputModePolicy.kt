package com.dancode.android.terminal

/**
 * Whether typed input is buffered as a line (Cooked) or sent
 * keystroke-by-keystroke (Raw).
 */
enum class InputMode { Cooked, Raw }

/**
 * Snapshot of the emulator flags the policy cares about. Kept as a plain
 * data class so the policy stays headless (no `TerminalEmulator` import
 * in tests).
 *
 * - [altScreenActive] mirrors `TerminalEmulator.isAlternateBufferActive()`
 *   (DECSET 1049 / 47 / 1047 — Termux consolidates them under one flag).
 * - [mouseTrackingActive] mirrors `TerminalEmulator.isMouseTrackingActive()`
 *   (DECSET 1000 / 1002 button-event tracking). Phase 4's scroll routing
 *   also treats DECSET 1006 (SGR encoding) as "tracking on" indirectly,
 *   since 1006 is only meaningful while 1000/1002 are also enabled.
 */
data class EmulatorModeState(
    val altScreenActive: Boolean,
    val mouseTrackingActive: Boolean,
)

/**
 * Decides which [InputMode] the UI should use, given the current emulator
 * state and any [manualOverride] the user has set.
 *
 * Auto policy: Raw whenever the emulator is on the alternate screen or
 * actively tracking mouse events; Cooked otherwise. The manual override
 * wins until cleared by the UI.
 *
 * The class is intentionally stateless w.r.t. the emulator — each
 * [resolve] call is a pure function of its arguments. The override is the
 * only mutable bit, and it lives in this object so the Compose UI can
 * round-trip "user toggled Raw" / "user toggled Cooked" without threading
 * any extra state.
 */
class InputModePolicy {

    var manualOverride: InputMode? = null
        private set

    fun setManualOverride(mode: InputMode) {
        manualOverride = mode
    }

    fun clearManualOverride() {
        manualOverride = null
    }

    fun resolve(state: EmulatorModeState): InputMode {
        manualOverride?.let { return it }
        return if (state.altScreenActive || state.mouseTrackingActive) InputMode.Raw else InputMode.Cooked
    }
}
