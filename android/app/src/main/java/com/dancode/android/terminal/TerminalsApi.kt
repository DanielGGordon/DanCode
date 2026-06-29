package com.dancode.android.terminal

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray

/**
 * `GET /api/terminals?project=<slug>` client. Mirrors
 * [com.dancode.android.projects.ProjectsApi] — the Bearer token is added
 * by the [com.dancode.android.net.BearerAuthInterceptor] attached to
 * [httpClient], so this class only issues the request and parses the
 * response.
 */
class TerminalsApi(private val httpClient: OkHttpClient) {

    sealed class ListResult {
        data class Success(val terminals: List<TerminalSummary>) : ListResult()
        data object Unauthorized : ListResult()
        data class Failure(val statusCode: Int, val message: String?) : ListResult()
        data class NetworkError(val cause: Throwable) : ListResult()
    }

    suspend fun list(baseUrl: String, projectSlug: String): ListResult = withContext(Dispatchers.IO) {
        val url = "${baseUrl.trimEnd('/')}/api/terminals".toHttpUrl()
            .newBuilder()
            .addQueryParameter("project", projectSlug)
            .build()
        val request = Request.Builder().url(url).get().build()
        try {
            httpClient.newCall(request).execute().use { response ->
                when {
                    response.code == 401 -> ListResult.Unauthorized
                    response.isSuccessful -> {
                        val body = response.body?.string().orEmpty()
                        ListResult.Success(parseTerminals(body))
                    }
                    else -> ListResult.Failure(response.code, response.body?.string())
                }
            }
        } catch (failure: Throwable) {
            ListResult.NetworkError(failure)
        }
    }

    private fun parseTerminals(body: String): List<TerminalSummary> {
        val array = JSONArray(body)
        val out = ArrayList<TerminalSummary>(array.length())
        for (i in 0 until array.length()) {
            val obj = array.getJSONObject(i)
            out += TerminalSummary(
                id = obj.getString("id"),
                projectSlug = obj.optString("projectSlug", ""),
                label = obj.optString("label", "Terminal"),
                command = obj.optStringOrNull("command"),
                cwd = obj.optStringOrNull("cwd"),
            )
        }
        return out
    }

    private fun org.json.JSONObject.optStringOrNull(name: String): String? {
        if (!has(name) || isNull(name)) return null
        val value = optString(name, "")
        return value.ifEmpty { null }
    }
}
