package com.dancode.android.terminal

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Pure-logic pinch detector tested headless. The Compose side feeds it
 * incremental scale factors from a `detectTransformGestures` block; this
 * class decides when an accumulated pinch crosses the per-step threshold
 * and emits a [FontSizeAction.Increase] / [FontSizeAction.Decrease].
 *
 * Threshold-based emission keeps the font size from jittering on every
 * micro-gesture event; the same pinch motion can naturally emit several
 * actions in a row (e.g. a big pinch-out) as the cumulative scale crosses
 * multiple thresholds.
 */
class PinchZoomDetectorTest {

    @Test
    fun small_scale_changes_emit_no_action() {
        val det = PinchZoomDetector()
        assertNull(det.onScale(1.0f))
        assertNull(det.onScale(1.05f))
        assertNull(det.onScale(0.96f))
    }

    @Test
    fun pinch_out_past_threshold_emits_increase() {
        val det = PinchZoomDetector()
        // A single big scale up past the 1.2x threshold.
        assertEquals(FontSizeAction.Increase, det.onScale(1.25f))
    }

    @Test
    fun pinch_in_past_threshold_emits_decrease() {
        val det = PinchZoomDetector()
        assertEquals(FontSizeAction.Decrease, det.onScale(0.80f))
    }

    @Test
    fun small_pinches_accumulate_until_threshold_then_emit() {
        val det = PinchZoomDetector()
        // 1.08 * 1.08 * 1.08 = 1.26 — crosses the 1.2x threshold on the third call.
        assertNull(det.onScale(1.08f))
        assertNull(det.onScale(1.08f))
        assertEquals(FontSizeAction.Increase, det.onScale(1.08f))
    }

    @Test
    fun after_emitting_the_accumulator_resets() {
        val det = PinchZoomDetector()
        assertEquals(FontSizeAction.Increase, det.onScale(1.25f))
        // Immediately scaling 1.0 should NOT emit again.
        assertNull(det.onScale(1.0f))
        // But another 1.25 should emit again.
        assertEquals(FontSizeAction.Increase, det.onScale(1.25f))
    }

    @Test
    fun reset_clears_accumulated_state() {
        val det = PinchZoomDetector()
        det.onScale(1.18f) // below threshold, still accumulating
        det.reset()
        // After reset, an in-progress accumulation shouldn't carry over.
        assertNull(det.onScale(1.05f))
    }

    @Test
    fun direction_reversal_resets_accumulator() {
        // Some Compose gesture sources flip-flop slightly. A 1.15 then a
        // 0.95 should not be misread as "1.15 / 0.95 = 1.21 → increase".
        val det = PinchZoomDetector()
        assertNull(det.onScale(1.15f))
        assertNull(det.onScale(0.95f))
        assertNull(det.onScale(1.10f))
    }
}
