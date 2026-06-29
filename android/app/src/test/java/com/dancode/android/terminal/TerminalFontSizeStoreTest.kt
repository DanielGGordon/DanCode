package com.dancode.android.terminal

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Acceptance criterion 2 — "terminal font size is persisted per terminal id
 * across app restarts". The store is the durable side of that contract; the
 * UI layer reads/writes through it.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class TerminalFontSizeStoreTest {

    private lateinit var ctx: Context

    @Before
    fun setUp() {
        ctx = ApplicationProvider.getApplicationContext()
        // Clear any persisted prefs between tests so each starts on the default.
        ctx.getSharedPreferences(TerminalFontSizeStore.PREFS_FILE, Context.MODE_PRIVATE)
            .edit().clear().commit()
    }

    @Test
    fun read_returns_default_when_unset() {
        val store = TerminalFontSizeStore.create(ctx)
        assertEquals(TerminalFontSizeStore.DEFAULT, store.read("term-1"))
    }

    @Test
    fun save_then_read_round_trips() {
        val store = TerminalFontSizeStore.create(ctx)
        store.save("term-1", 22)
        assertEquals(22, store.read("term-1"))
    }

    @Test
    fun values_are_per_id() {
        val store = TerminalFontSizeStore.create(ctx)
        store.save("term-a", 18)
        store.save("term-b", 26)
        assertEquals(18, store.read("term-a"))
        assertEquals(26, store.read("term-b"))
    }

    @Test
    fun read_after_recreate_returns_persisted_value() {
        // "Persisted across app restarts" — simulate by tearing down the
        // store instance and creating a fresh one against the same prefs file.
        TerminalFontSizeStore.create(ctx).save("term-1", 30)
        val reborn = TerminalFontSizeStore.create(ctx)
        assertEquals(30, reborn.read("term-1"))
    }

    @Test
    fun save_clamps_below_min() {
        val store = TerminalFontSizeStore.create(ctx)
        store.save("t", TerminalFontSizeStore.MIN - 5)
        assertEquals(TerminalFontSizeStore.MIN, store.read("t"))
    }

    @Test
    fun save_clamps_above_max() {
        val store = TerminalFontSizeStore.create(ctx)
        store.save("t", TerminalFontSizeStore.MAX + 10)
        assertEquals(TerminalFontSizeStore.MAX, store.read("t"))
    }

    @Test
    fun step_increments_and_persists_within_bounds() {
        val store = TerminalFontSizeStore.create(ctx)
        // Default is DEFAULT; step(+1) -> DEFAULT+2 (font sizes step by 2sp)
        val first = store.step("t", +1)
        val second = store.step("t", +1)
        assertEquals(TerminalFontSizeStore.DEFAULT + 2, first)
        assertEquals(TerminalFontSizeStore.DEFAULT + 4, second)
        assertEquals(second, store.read("t"))
    }

    @Test
    fun step_decrements_and_clamps_at_min() {
        val store = TerminalFontSizeStore.create(ctx)
        store.save("t", TerminalFontSizeStore.MIN)
        val clamped = store.step("t", -1)
        assertEquals(TerminalFontSizeStore.MIN, clamped)
    }

    @Test
    fun reset_clears_to_default() {
        val store = TerminalFontSizeStore.create(ctx)
        store.save("t", 28)
        store.reset("t")
        assertEquals(TerminalFontSizeStore.DEFAULT, store.read("t"))
    }
}
