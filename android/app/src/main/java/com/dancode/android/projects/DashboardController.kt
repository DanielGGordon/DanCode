package com.dancode.android.projects

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * State holder for the dashboard. Owns the loading lifecycle and decides
 * what happens for each [ProjectsApi.ListResult] — most importantly,
 * `Unauthorized` triggers [onUnauthorized] so the UI layer can route back
 * to the login screen (acceptance criterion 4, final clause).
 */
class DashboardController(
    private val api: ProjectsApi,
    private val baseUrl: String,
    private val onUnauthorized: () -> Unit,
) {
    private val _state = MutableStateFlow<DashboardState>(DashboardState.Loading)
    val state: StateFlow<DashboardState> = _state.asStateFlow()

    suspend fun load() {
        _state.value = DashboardState.Loading
        when (val result = api.list(baseUrl)) {
            is ProjectsApi.ListResult.Success ->
                _state.value = DashboardState.Loaded(result.projects)
            ProjectsApi.ListResult.Unauthorized -> {
                _state.value = DashboardState.Error("Session expired")
                onUnauthorized()
            }
            is ProjectsApi.ListResult.Failure ->
                _state.value = DashboardState.Error("Could not load projects (${result.statusCode})")
            is ProjectsApi.ListResult.NetworkError ->
                _state.value = DashboardState.Error("Network error")
        }
    }
}
