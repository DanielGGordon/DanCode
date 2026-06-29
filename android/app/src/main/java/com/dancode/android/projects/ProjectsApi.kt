package com.dancode.android.projects

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray

/**
 * `GET /api/projects` client. The Bearer header is injected by the
 * [com.dancode.android.net.BearerAuthInterceptor] attached to [httpClient];
 * this class is only responsible for issuing the request and parsing the
 * response, so callers route 401 results through the same channel
 * regardless of which screen made the call.
 */
class ProjectsApi(private val httpClient: OkHttpClient) {

    sealed class ListResult {
        data class Success(val projects: List<Project>) : ListResult()
        data object Unauthorized : ListResult()
        data class Failure(val statusCode: Int, val message: String?) : ListResult()
        data class NetworkError(val cause: Throwable) : ListResult()
    }

    suspend fun list(baseUrl: String): ListResult = withContext(Dispatchers.IO) {
        val url = "${baseUrl.trimEnd('/')}/api/projects"
        val request = Request.Builder().url(url).get().build()
        try {
            httpClient.newCall(request).execute().use { response ->
                when {
                    response.code == 401 -> ListResult.Unauthorized
                    response.isSuccessful -> {
                        val body = response.body?.string().orEmpty()
                        ListResult.Success(parseProjects(body))
                    }
                    else -> ListResult.Failure(response.code, response.body?.string())
                }
            }
        } catch (failure: Throwable) {
            ListResult.NetworkError(failure)
        }
    }

    private fun parseProjects(body: String): List<Project> {
        val array = JSONArray(body)
        val out = ArrayList<Project>(array.length())
        for (i in 0 until array.length()) {
            val obj = array.getJSONObject(i)
            out += Project(
                name = obj.getString("name"),
                slug = obj.getString("slug"),
                path = obj.optString("path", ""),
            )
        }
        return out
    }
}
