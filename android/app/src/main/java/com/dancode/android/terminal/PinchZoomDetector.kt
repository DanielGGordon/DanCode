package com.dancode.android.terminal

/**
 * Stateful pinch detector that converts a stream of incremental scale
 * factors (one per Compose pointer-event frame) into discrete font-size
 * adjustments. A small per-frame ratio is ignored; once the *product* of
 * consecutive ratios in the same direction crosses [THRESHOLD_INCREASE] or
 * [THRESHOLD_DECREASE], one [FontSizeAction] is emitted and the
 * accumulator resets.
 *
 * Reversing direction also resets the accumulator so a noisy gesture
 * doesn't accidentally trip a threshold by multiplying contradictory
 * scales.
 */
class PinchZoomDetector {
    private var cumulative: Float = 1f
    private var lastDirection: Int = 0 // -1 in, +1 out, 0 unknown

    /**
     * @param scale incremental scale factor since the previous event.
     *              `1.0` means "no change". Values slightly above 1 are
     *              pinch-out, below 1 are pinch-in.
     * @return an action when the cumulative pinch crosses a threshold,
     *         else null.
     */
    fun onScale(scale: Float): FontSizeAction? {
        val direction = when {
            scale > 1.001f -> +1
            scale < 0.999f -> -1
            else -> 0
        }
        if (direction == 0) return null
        if (lastDirection != 0 && direction != lastDirection) {
            cumulative = 1f
            lastDirection = direction
            return null
        }
        lastDirection = direction
        cumulative *= scale
        return when {
            cumulative >= THRESHOLD_INCREASE -> { reset(); FontSizeAction.Increase }
            cumulative <= THRESHOLD_DECREASE -> { reset(); FontSizeAction.Decrease }
            else -> null
        }
    }

    fun reset() {
        cumulative = 1f
        lastDirection = 0
    }

    companion object {
        const val THRESHOLD_INCREASE = 1.20f
        const val THRESHOLD_DECREASE = 0.83f
    }
}
