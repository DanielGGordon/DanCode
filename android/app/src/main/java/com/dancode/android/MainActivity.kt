package com.dancode.android

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import com.dancode.android.auth.AuthApi
import com.dancode.android.auth.LoginController
import com.dancode.android.auth.LoginScreen
import com.dancode.android.auth.TokenStorage
import com.dancode.android.net.BearerAuthInterceptor
import com.dancode.android.projects.DashboardController
import com.dancode.android.projects.DashboardScreen
import com.dancode.android.projects.ProjectsApi
import okhttp3.OkHttpClient

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val tokenStorage = TokenStorage.create(this)
        val authedClient = OkHttpClient.Builder()
            .addInterceptor(BearerAuthInterceptor { tokenStorage.read() })
            .build()
        val authApi = AuthApi(OkHttpClient())
        val projectsApi = ProjectsApi(authedClient)

        setContent {
            MaterialTheme {
                AppNav(
                    tokenStorage = tokenStorage,
                    authApi = authApi,
                    projectsApi = projectsApi,
                )
            }
        }
    }
}

private enum class Screen { Login, Dashboard }

@Composable
private fun AppNav(
    tokenStorage: TokenStorage,
    authApi: AuthApi,
    projectsApi: ProjectsApi,
) {
    var screen by remember {
        mutableStateOf(if (tokenStorage.read() != null) Screen.Dashboard else Screen.Login)
    }
    var serverUrl by remember {
        mutableStateOf(LoginController.DEFAULT_SERVER_URL)
    }

    when (screen) {
        Screen.Login -> {
            val controller = remember {
                LoginController(
                    authApi = authApi,
                    tokenStorage = tokenStorage,
                    onLoggedIn = { screen = Screen.Dashboard },
                    initialServerUrl = serverUrl,
                )
            }
            // Track the URL the user typed so the dashboard can reuse it.
            LaunchedEffect(controller) {
                controller.state.collect { serverUrl = it.serverUrl }
            }
            LoginScreen(controller = controller)
        }
        Screen.Dashboard -> {
            val controller = remember(serverUrl) {
                DashboardController(
                    api = projectsApi,
                    baseUrl = serverUrl,
                    onUnauthorized = {
                        tokenStorage.clear()
                        screen = Screen.Login
                    },
                )
            }
            LaunchedEffect(controller) { controller.load() }
            val state by controller.state.collectAsState()
            DashboardScreen(state = state)
        }
    }
}
