package com.dancode.android.auth

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

data class LoginFormState(
    val serverUrl: String,
    val username: String = "",
    val password: String = "",
    val totp: String = "",
    val isSubmitting: Boolean = false,
    val errorMessage: String? = null,
)

/**
 * State holder for the login screen. Tracks form input, drives the
 * AuthApi.login call, persists the returned token in [TokenStorage], and
 * fires [onLoggedIn] on success so the surrounding navigator can swap to
 * the dashboard.
 */
class LoginController(
    private val authApi: AuthApi,
    private val tokenStorage: TokenStorage,
    private val onLoggedIn: () -> Unit,
    initialServerUrl: String = DEFAULT_SERVER_URL,
) {
    private val _state = MutableStateFlow(LoginFormState(serverUrl = initialServerUrl))
    val state: StateFlow<LoginFormState> = _state.asStateFlow()

    fun updateServerUrl(value: String) = _state.update { it.copy(serverUrl = value) }
    fun updateUsername(value: String) = _state.update { it.copy(username = value) }
    fun updatePassword(value: String) = _state.update { it.copy(password = value) }
    fun updateTotp(value: String) = _state.update { it.copy(totp = value) }

    suspend fun submit() {
        val snapshot = _state.value
        if (snapshot.serverUrl.isBlank() ||
            snapshot.username.isBlank() ||
            snapshot.password.isBlank() ||
            snapshot.totp.isBlank()
        ) {
            _state.update { it.copy(errorMessage = "All fields are required") }
            return
        }

        _state.update { it.copy(isSubmitting = true, errorMessage = null) }

        val result = authApi.login(
            baseUrl = snapshot.serverUrl,
            username = snapshot.username,
            password = snapshot.password,
            totpCode = snapshot.totp,
        )

        when (result) {
            is AuthApi.LoginResult.Success -> {
                tokenStorage.save(result.token)
                _state.update { it.copy(isSubmitting = false, errorMessage = null) }
                onLoggedIn()
            }
            is AuthApi.LoginResult.Failure -> _state.update {
                it.copy(
                    isSubmitting = false,
                    errorMessage = result.errorMessage?.takeIf(String::isNotBlank)
                        ?: "Login failed (${result.statusCode})",
                )
            }
            is AuthApi.LoginResult.NetworkError -> _state.update {
                it.copy(
                    isSubmitting = false,
                    errorMessage = "Network error: ${result.cause.message ?: result.cause.javaClass.simpleName}",
                )
            }
        }
    }

    companion object {
        /**
         * Default points at the new HTTPS terminator (Phase 2 acceptance
         * criterion 3) — keep in sync with [com.dancode.android.config.AppConfig.DEFAULT_SERVER_URL].
         */
        const val DEFAULT_SERVER_URL = "https://5.78.231.51:8443"
    }
}
