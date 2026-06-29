package com.dancode.android.terminal

import kotlin.math.max

/**
 * Pure-JVM helpers for deriving the terminal's grid dimensions from the
 * hosting view's pixel size and the renderer's cell size. The Termux
 * `TerminalRenderer` is the source of truth for `cellWidthPx` /
 * `cellHeightPx` at runtime; these helpers package the math so it can be
 * exercised headless and so the production path has a single place to
 * apply the floor + minimum-one-by-one rules.
 */
object TerminalViewMetrics {

    /**
     * Heuristic cell width / height for the given pixel font size.
     *
     * These ratios match the Termux renderer's `Paint` measurements for
     * its bundled monospace font closely enough for resize calculations
     * before the real `Paint` has been laid out — once the view is on
     * screen its own metrics take over. We only need scale-with-font-size
     * and width < height to be true.
     */
    fun cellSizeForFont(fontSizePx: Float): Pair<Float, Float> {
        val width = fontSizePx * CELL_WIDTH_RATIO
        val height = fontSizePx * CELL_HEIGHT_RATIO
        return width to height
    }

    fun gridDimensions(
        viewWidthPx: Int,
        viewHeightPx: Int,
        cellWidthPx: Float,
        cellHeightPx: Float,
    ): Pair<Int, Int> {
        if (cellWidthPx <= 0f || cellHeightPx <= 0f) return 1 to 1
        if (viewWidthPx <= 0 || viewHeightPx <= 0) return 1 to 1
        val cols = (viewWidthPx / cellWidthPx).toInt()
        val rows = (viewHeightPx / cellHeightPx).toInt()
        return max(1, cols) to max(1, rows)
    }

    private const val CELL_WIDTH_RATIO = 0.6f
    private const val CELL_HEIGHT_RATIO = 1.2f
}
