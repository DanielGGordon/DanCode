package com.dancode.android.auth

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Drives the public contract of [TokenStorage]: round-trip a token, surface
 * null when none is stored, and clear it. The Robolectric runtime supplies a
 * concrete [Context] so the EncryptedSharedPreferences-backed implementation
 * is exercised end-to-end on the JVM.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class TokenStorageTest {

    private lateinit var context: Context
    private lateinit var storage: TokenStorage

    @Before
    fun setUp() {
        context = ApplicationProvider.getApplicationContext()
        storage = TokenStorage.create(context, prefsFileName = "test-auth-prefs")
        storage.clear()
    }

    @Test
    fun read_returns_null_when_no_token_saved() {
        assertNull(storage.read())
    }

    @Test
    fun save_then_read_returns_the_persisted_token() {
        storage.save("abc-123")

        assertEquals("abc-123", storage.read())
    }

    @Test
    fun clear_removes_a_previously_saved_token() {
        storage.save("temp")

        storage.clear()

        assertNull(storage.read())
    }

    @Test
    fun save_overwrites_a_previously_saved_token() {
        storage.save("first")
        storage.save("second")

        assertEquals("second", storage.read())
    }
}
