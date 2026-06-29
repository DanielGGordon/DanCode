package com.dancode.android.terminal

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Auto-switch policy for cooked ↔ raw input mode.
 *
 * Source of truth: the emulator's alt-screen flag (DECSET 1049) or its
 * mouse-tracking flag (DECSET 1000/1006). When either is on, raw-mode
 * passthrough is required because the foreground app — Claude Code,
 * vim, less — wants per-keystroke bytes. When both go off, the policy
 * reverts to cooked (line-buffered).
 *
 * The manual override is a UI affordance: when set, the policy returns
 * the override and ignores the emulator until cleared. This lets the
 * user force a mode when auto-detection disagrees (e.g. the alt-screen
 * is up but they still want line-by-line entry).
 */
class InputModePolicyTest {

    @Test
    fun defaults_to_cooked_when_emulator_is_in_normal_screen() {
        val policy = InputModePolicy()
        assertEquals(InputMode.Cooked, policy.resolve(state(altScreen = false, mouseTracking = false)))
    }

    @Test
    fun engages_raw_when_emulator_enters_alt_screen() {
        val policy = InputModePolicy()
        assertEquals(InputMode.Raw, policy.resolve(state(altScreen = true, mouseTracking = false)))
    }

    @Test
    fun engages_raw_when_emulator_starts_mouse_tracking_even_outside_alt_screen() {
        val policy = InputModePolicy()
        assertEquals(InputMode.Raw, policy.resolve(state(altScreen = false, mouseTracking = true)))
    }

    @Test
    fun reverts_to_cooked_when_alt_screen_and_mouse_tracking_both_clear() {
        val policy = InputModePolicy()
        // Enter alt-screen, then leave.
        policy.resolve(state(altScreen = true, mouseTracking = false))
        assertEquals(InputMode.Cooked, policy.resolve(state(altScreen = false, mouseTracking = false)))
    }

    @Test
    fun manual_override_wins_over_auto_detection() {
        val policy = InputModePolicy()
        // Auto would pick Raw — but the user has forced Cooked.
        policy.setManualOverride(InputMode.Cooked)
        assertEquals(InputMode.Cooked, policy.resolve(state(altScreen = true, mouseTracking = true)))
    }

    @Test
    fun manual_override_forces_raw_when_emulator_is_in_normal_screen() {
        val policy = InputModePolicy()
        policy.setManualOverride(InputMode.Raw)
        assertEquals(InputMode.Raw, policy.resolve(state(altScreen = false, mouseTracking = false)))
    }

    @Test
    fun clearing_the_override_returns_control_to_auto_detection() {
        val policy = InputModePolicy()
        policy.setManualOverride(InputMode.Cooked)
        policy.clearManualOverride()
        assertEquals(InputMode.Raw, policy.resolve(state(altScreen = true, mouseTracking = false)))
        assertEquals(InputMode.Cooked, policy.resolve(state(altScreen = false, mouseTracking = false)))
    }

    @Test
    fun override_is_observable_via_getter() {
        val policy = InputModePolicy()
        assertEquals(null, policy.manualOverride)
        policy.setManualOverride(InputMode.Raw)
        assertEquals(InputMode.Raw, policy.manualOverride)
        policy.clearManualOverride()
        assertEquals(null, policy.manualOverride)
    }

    private fun state(altScreen: Boolean, mouseTracking: Boolean) =
        EmulatorModeState(altScreenActive = altScreen, mouseTrackingActive = mouseTracking)
}
