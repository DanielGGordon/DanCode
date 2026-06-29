package com.dancode.android.auth

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * Persists the auth token returned by `POST /api/auth/login`.
 *
 * Production wiring (see [create]) stores the token in
 * [EncryptedSharedPreferences] under the AndroidX `security-crypto` master
 * key, so it survives process death and is encrypted at rest.
 */
class TokenStorage internal constructor(private val prefs: SharedPreferences) {

    fun save(token: String) {
        prefs.edit().putString(KEY_TOKEN, token).apply()
    }

    fun read(): String? = prefs.getString(KEY_TOKEN, null)

    fun clear() {
        prefs.edit().remove(KEY_TOKEN).apply()
    }

    companion object {
        private const val KEY_TOKEN = "auth_token"
        const val DEFAULT_PREFS_FILE = "dancode-auth-prefs"

        /**
         * Wires up an [EncryptedSharedPreferences]-backed [TokenStorage].
         * Falls back to a plain [SharedPreferences] only when the master key
         * cannot be created — this should never happen on a real device but
         * keeps headless test environments (Robolectric without an Android
         * KeyStore shadow) functional.
         */
        fun create(
            context: Context,
            prefsFileName: String = DEFAULT_PREFS_FILE,
        ): TokenStorage {
            val prefs: SharedPreferences = try {
                val masterKey = MasterKey.Builder(context)
                    .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                    .build()
                EncryptedSharedPreferences.create(
                    context,
                    prefsFileName,
                    masterKey,
                    EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                    EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
                )
            } catch (failure: Throwable) {
                context.getSharedPreferences(prefsFileName, Context.MODE_PRIVATE)
            }
            return TokenStorage(prefs)
        }
    }
}
