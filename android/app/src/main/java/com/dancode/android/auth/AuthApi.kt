package com.dancode.android.auth

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject

/**
 * `POST /api/auth/login` client.
 *
 * The body shape (`{username,password,totpCode}`) and response shape
 * (`{token: "..."}` on success, `{error: "..."}` on 4xx) match the existing
 * Node backend exactly — see server/src/index.js around line 179.
 */
class AuthApi(private val httpClient: OkHttpClient = OkHttpClient()) {

    sealed class LoginResult {
        data class Success(val token: String) : LoginResult()
        data class Failure(val statusCode: Int, val errorMessage: String?) : LoginResult()
        data class NetworkError(val cause: Throwable) : LoginResult()
    }

    suspend fun login(
        baseUrl: String,
        username: String,
        password: String,
        totpCode: String,
    ): LoginResult = withContext(Dispatchers.IO) {
        val url = "${baseUrl.trimEnd('/')}/api/auth/login"
        val body = JSONObject().apply {
            put("username", username)
            put("password", password)
            put("totpCode", totpCode)
        }.toString().toRequestBody(JSON)

        val request = Request.Builder()
            .url(url)
            .post(body)
            .header("Content-Type", "application/json")
            .build()

        try {
            httpClient.newCall(request).execute().use { response ->
                val payload = response.body?.string().orEmpty()
                if (response.isSuccessful) {
                    val token = runCatching { JSONObject(payload).getString("token") }
                        .getOrNull()
                    if (token.isNullOrBlank()) {
                        LoginResult.Failure(response.code, "Malformed login response")
                    } else {
                        LoginResult.Success(token)
                    }
                } else {
                    val errorMessage = runCatching {
                        val obj = JSONObject(payload)
                        if (obj.has("error")) obj.getString("error") else null
                    }.getOrNull()
                    LoginResult.Failure(response.code, errorMessage)
                }
            }
        } catch (failure: Throwable) {
            LoginResult.NetworkError(failure)
        }
    }

    private companion object {
        val JSON = "application/json; charset=utf-8".toMediaType()
    }
}
