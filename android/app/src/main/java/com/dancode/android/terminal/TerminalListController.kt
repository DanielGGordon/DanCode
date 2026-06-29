package com.dancode.android.terminal

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

sealed class TerminalListState {
    data object Loading : TerminalListState()
    data class Loaded(val terminals: List<TerminalSummary>) : TerminalListState()
    data class Error(val message: String) : TerminalListState()
}

/**
 * State holder for the per-project terminal list. Owns the loading
 * lifecycle and routes `Unauthorized` to [onUnauthorized] so the UI layer
 * can drop the token and return to login (the same pattern as
 * [com.dancode.android.projects.DashboardController]).
 */
class TerminalListController(
    private val api: TerminalsApi,
    private val baseUrl: String,
    private val projectSlug: String,
    private val onUnauthorized: () -> Unit,
) {
    private val _state = MutableStateFlow<TerminalListState>(TerminalListState.Loading)
    val state: StateFlow<TerminalListState> = _state.asStateFlow()

    suspend fun load() {
        _state.value = TerminalListState.Loading
        when (val result = api.list(baseUrl, projectSlug)) {
            is TerminalsApi.ListResult.Success ->
                _state.value = TerminalListState.Loaded(result.terminals)
            TerminalsApi.ListResult.Unauthorized -> {
                _state.value = TerminalListState.Error("Session expired")
                onUnauthorized()
            }
            is TerminalsApi.ListResult.Failure ->
                _state.value = TerminalListState.Error(
                    "Could not load terminals (${result.statusCode})",
                )
            is TerminalsApi.ListResult.NetworkError ->
                _state.value = TerminalListState.Error("Network error")
        }
    }
}
