package com.dancode.android.net

import okhttp3.Interceptor
import okhttp3.Response

/**
 * OkHttp interceptor that injects `Authorization: Bearer <token>` when the
 * supplied [tokenProvider] returns a non-null value. The provider is invoked
 * per-request so a token change (logout, re-login) propagates without
 * rebuilding the client.
 */
class BearerAuthInterceptor(
    private val tokenProvider: () -> String?,
) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val token = tokenProvider()
        val request = chain.request()
        val authorized = if (token != null) {
            request.newBuilder().header("Authorization", "Bearer $token").build()
        } else {
            request
        }
        return chain.proceed(authorized)
    }
}
