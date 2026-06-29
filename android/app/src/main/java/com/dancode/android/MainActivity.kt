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
import com.dancode.android.projects.Project
import com.dancode.android.projects.ProjectsApi
import com.dancode.android.terminal.TerminalHost
import com.dancode.android.terminal.TerminalListController
import com.dancode.android.terminal.TerminalListScreen
import com.dancode.android.terminal.TerminalSummary
import com.dancode.android.terminal.TerminalsApi
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
        val terminalsApi = TerminalsApi(authedClient)

        setContent {
            MaterialTheme {
                AppNav(
                    tokenStorage = tokenStorage,
                    authApi = authApi,
                    projectsApi = projectsApi,
                    terminalsApi = terminalsApi,
                    authedClient = authedClient,
                )
            }
        }
    }
}

private sealed class Screen {
    data object Login : Screen()
    data object Dashboard : Screen()
    data class TerminalList(val project: Project) : Screen()
    data class Terminal(val project: Project, val terminal: TerminalSummary) : Screen()
}

@Composable
private fun AppNav(
    tokenStorage: TokenStorage,
    authApi: AuthApi,
    projectsApi: ProjectsApi,
    terminalsApi: TerminalsApi,
    authedClient: OkHttpClient,
) {
    var screen: Screen by remember {
        mutableStateOf(if (tokenStorage.read() != null) Screen.Dashboard else Screen.Login)
    }
    var serverUrl by remember { mutableStateOf(LoginController.DEFAULT_SERVER_URL) }

    val onUnauthorized: () -> Unit = remember {
        {
            tokenStorage.clear()
            screen = Screen.Login
        }
    }

    when (val current = screen) {
        is Screen.Login -> {
            val controller = remember {
                LoginController(
                    authApi = authApi,
                    tokenStorage = tokenStorage,
                    onLoggedIn = { screen = Screen.Dashboard },
                    initialServerUrl = serverUrl,
                )
            }
            LaunchedEffect(controller) {
                controller.state.collect { serverUrl = it.serverUrl }
            }
            LoginScreen(controller = controller)
        }
        is Screen.Dashboard -> {
            val controller = remember(serverUrl) {
                DashboardController(
                    api = projectsApi,
                    baseUrl = serverUrl,
                    onUnauthorized = onUnauthorized,
                )
            }
            LaunchedEffect(controller) { controller.load() }
            val state by controller.state.collectAsState()
            DashboardScreen(
                state = state,
                onSelect = { project -> screen = Screen.TerminalList(project) },
            )
        }
        is Screen.TerminalList -> {
            val controller = remember(current.project.slug, serverUrl) {
                TerminalListController(
                    api = terminalsApi,
                    baseUrl = serverUrl,
                    projectSlug = current.project.slug,
                    onUnauthorized = onUnauthorized,
                )
            }
            LaunchedEffect(controller) { controller.load() }
            val state by controller.state.collectAsState()
            TerminalListScreen(
                state = state,
                onSelect = { terminal -> screen = Screen.Terminal(current.project, terminal) },
            )
        }
        is Screen.Terminal -> {
            val token = tokenStorage.read()
            if (token == null) {
                onUnauthorized()
            } else {
                TerminalHost(
                    terminal = current.terminal,
                    serverBaseUrl = serverUrl,
                    httpClient = authedClient,
                    token = token,
                    onBack = { screen = Screen.TerminalList(current.project) },
                )
            }
        }
    }
}
