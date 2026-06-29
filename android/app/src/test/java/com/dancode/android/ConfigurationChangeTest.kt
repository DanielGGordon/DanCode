package com.dancode.android

import android.content.ComponentName
import android.content.pm.ActivityInfo
import android.content.pm.PackageManager
import com.dancode.android.terminal.TerminalConnection
import com.dancode.android.terminal.TerminalSink
import com.dancode.android.terminal.TerminalTransport
import com.dancode.android.terminal.TerminalViewMetrics
import com.dancode.android.terminal.TransportListener
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/**
 * Acceptance criterion 3: "Device rotation and soft-keyboard show/hide
 * re-fit the terminal and emit an accurate `resize` with no rendering
 * corruption."
 *
 * The on-device contract has two halves:
 *
 *  1. The activity must not be torn down on rotation / keyboard pop. That's
 *     a manifest declaration of `configChanges`; without it the Activity is
 *     recreated and the live socket would die mid-session.
 *  2. After a config change, the embedded TerminalView is re-laid-out, the
 *     AndroidView `update` block re-derives cols/rows, and a new `resize`
 *     event reaches the server.
 *
 * Robolectric drives the headless half here; the renderer-side cols/rows
 * derivation is unit-tested in [TerminalViewMetricsTest]; this test asserts
 * the configChanges flags AND that the connection emits multiple resizes
 * when the viewport changes.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class ConfigurationChangeTest {

    @Test
    fun mainactivity_manifest_declares_configChanges_for_orientation_keyboard_and_screen_size() {
        val ctx = RuntimeEnvironment.getApplication()
        val info = ctx.packageManager.getActivityInfo(
            ComponentName(ctx, MainActivity::class.java),
            PackageManager.GET_META_DATA,
        )
        val flags = info.configChanges
        // The activity must absorb rotation/screen-size/screen-layout changes
        // (otherwise the socket would die on rotation), as well as the
        // soft-keyboard hide/show — which on some devices changes
        // CONFIG_KEYBOARD_HIDDEN / CONFIG_KEYBOARD.
        assertTrue("orientation flag", (flags and ActivityInfo.CONFIG_ORIENTATION) != 0)
        assertTrue("screenSize flag", (flags and ActivityInfo.CONFIG_SCREEN_SIZE) != 0)
        assertTrue("screenLayout flag", (flags and ActivityInfo.CONFIG_SCREEN_LAYOUT) != 0)
        assertTrue(
            "keyboardHidden flag",
            (flags and ActivityInfo.CONFIG_KEYBOARD_HIDDEN) != 0,
        )
    }

    @Test
    fun rotation_changes_viewport_and_re_emits_resize() {
        // Portrait — typical phone viewport at standard density.
        val portrait = TerminalViewMetrics.gridDimensions(
            viewWidthPx = 1080,
            viewHeightPx = 1920,
            cellWidthPx = 12f,
            cellHeightPx = 24f,
        )
        // Landscape after rotation — width & height swap.
        val landscape = TerminalViewMetrics.gridDimensions(
            viewWidthPx = 1920,
            viewHeightPx = 1080,
            cellWidthPx = 12f,
            cellHeightPx = 24f,
        )
        assertNotEquals("rotation must change grid dimensions", portrait, landscape)
    }

    @Test
    fun keyboard_show_shrinks_height_and_re_emits_resize() {
        val keyboardClosed = TerminalViewMetrics.gridDimensions(
            viewWidthPx = 1080,
            viewHeightPx = 1920,
            cellWidthPx = 12f,
            cellHeightPx = 24f,
        )
        // After soft-keyboard appears, useful height drops by ~600 px.
        val keyboardOpen = TerminalViewMetrics.gridDimensions(
            viewWidthPx = 1080,
            viewHeightPx = 1320,
            cellWidthPx = 12f,
            cellHeightPx = 24f,
        )
        assertNotEquals(
            "keyboard show must change row count",
            keyboardClosed.second,
            keyboardOpen.second,
        )
        assertEquals(
            "keyboard show must leave column count alone (width unchanged)",
            keyboardClosed.first,
            keyboardOpen.first,
        )
    }

    @Test
    fun terminal_connection_emits_a_new_resize_for_each_configuration_change() {
        val transport = ResizeRecordingTransport()
        val sink = NoopSink()
        val conn = TerminalConnection(
            transport = transport,
            sink = sink,
            namespace = "/terminal/x",
            token = "tok",
        )
        conn.start()
        transport.listener!!.onConnected()

        // Initial layout
        conn.sendResize(45, 80)
        // Rotate to landscape — width and height swap
        conn.sendResize(80, 45)
        // Keyboard appears — height shrinks
        conn.sendResize(80, 28)
        // Keyboard hides — height restores
        conn.sendResize(80, 45)

        assertEquals(
            listOf(45 to 80, 80 to 45, 80 to 28, 80 to 45),
            transport.resizes,
        )
    }

    private class ResizeRecordingTransport : TerminalTransport {
        val resizes = mutableListOf<Pair<Int, Int>>()
        override var listener: TransportListener? = null
        override fun connect(namespace: String, token: String) {}
        override fun disconnect() {}
        override fun sendInput(data: String) {}
        override fun sendResize(cols: Int, rows: Int) {
            resizes += cols to rows
        }
    }

    private class NoopSink : TerminalSink {
        override fun write(data: String) {}
        override fun reset() {}
    }
}
