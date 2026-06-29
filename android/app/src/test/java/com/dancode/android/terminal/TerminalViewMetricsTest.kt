package com.dancode.android.terminal

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * cols/rows derivation from view metrics + cell dimensions.
 *
 * The Android side ultimately gets `cellWidthPx`/`cellHeightPx` from the
 * Termux `TerminalRenderer`'s `Paint`, but the math itself is pure and
 * fully testable on the JVM. We assert: integer floor (TUIs would render
 * garbage if cols/rows reported a partial cell), a hard minimum of 1×1
 * (the server contract requires positive dimensions even before layout
 * has reported a non-zero size), and graceful handling of zero/negative
 * inputs that occasionally arrive during configuration changes.
 */
class TerminalViewMetricsTest {

    @Test
    fun cols_and_rows_are_floor_of_view_over_cell() {
        val (cols, rows) = TerminalViewMetrics.gridDimensions(
            viewWidthPx = 800,
            viewHeightPx = 1200,
            cellWidthPx = 10f,
            cellHeightPx = 20f,
        )
        assertEquals(80, cols)
        assertEquals(60, rows)
    }

    @Test
    fun partial_cell_at_the_right_or_bottom_is_floored_off() {
        val (cols, rows) = TerminalViewMetrics.gridDimensions(
            viewWidthPx = 805,
            viewHeightPx = 1219,
            cellWidthPx = 10f,
            cellHeightPx = 20f,
        )
        assertEquals(80, cols)
        assertEquals(60, rows)
    }

    @Test
    fun clamps_to_minimum_one_by_one_when_view_is_zero() {
        val (cols, rows) = TerminalViewMetrics.gridDimensions(
            viewWidthPx = 0,
            viewHeightPx = 0,
            cellWidthPx = 10f,
            cellHeightPx = 20f,
        )
        assertEquals(1, cols)
        assertEquals(1, rows)
    }

    @Test
    fun clamps_to_minimum_one_by_one_when_cell_is_garbage() {
        val (cols, rows) = TerminalViewMetrics.gridDimensions(
            viewWidthPx = 800,
            viewHeightPx = 1200,
            cellWidthPx = 0f,
            cellHeightPx = -1f,
        )
        assertEquals(1, cols)
        assertEquals(1, rows)
    }

    @Test
    fun cell_size_scales_with_font_size() {
        val small = TerminalViewMetrics.cellSizeForFont(fontSizePx = 10f)
        val large = TerminalViewMetrics.cellSizeForFont(fontSizePx = 20f)
        assertEquals(small.first * 2, large.first, 0.01f)
        assertEquals(small.second * 2, large.second, 0.01f)
    }

    @Test
    fun cell_size_height_is_taller_than_width_like_real_monospace() {
        val (w, h) = TerminalViewMetrics.cellSizeForFont(fontSizePx = 14f)
        assertEquals("cellWidth should be positive", true, w > 0f)
        assertEquals("cellHeight should be positive", true, h > 0f)
        assertEquals("cellHeight > cellWidth for monospace cells", true, h > w)
    }
}
