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
import com.dancode.android.terminal.TerminalFontSizeStore
import com.dancode.android.terminal.TerminalHost
import com.dancode.android.terminal.TerminalListController
import com.dancode.android.terminal.TerminalListScreen
import com.dancode.android.terminal.TerminalListState
import com.dancode.android.terminal.TerminalsApi
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val tokenStorage = TokenStorage.create(this)
        val authedClient = OkHttpClient.Builder()
            .addInterceptor(BearerAuthInterceptor { tokenStorage.read() })
            .build()
        val authApi = AuthApi(OkHttpClient())
        val projectsApi = ProjectsApiProvider(authedClient)
        val terminalsApi = TerminalsApi(authedClient)
        val fontSizeStore = TerminalFontSizeStore.create(this)

        setContent {
            MaterialTheme {
                AppNav(
                    tokenStorage = tokenStorage,
                    authApi = authApi,
                    projectsApi = projectsApi,
                    terminalsApi = terminalsApi,
                    authedClient = authedClient,
                    fontSizeStore = fontSizeStore,
                )
            }
        }
    }
}

private typealias ProjectsApiProvider = com.dancode.android.projects.ProjectsApi

@Composable
private fun AppNav(
    tokenStorage: TokenStorage,
    authApi: AuthApi,
    projectsApi: ProjectsApiProvider,
    terminalsApi: TerminalsApi,
    authedClient: OkHttpClient,
    fontSizeStore: TerminalFontSizeStore,
) {
    val nav = remember { AppNavController(initialHasToken = tokenStorage.read() != null) }
    var serverUrl by remember { mutableStateOf(LoginController.DEFAULT_SERVER_URL) }
    val screen by nav.state.collectAsState()

    val onUnauthorized: () -> Unit = remember(nav) {
        {
            tokenStorage.clear()
            nav.unauthorized()
        }
    }

    when (val current = screen) {
        is Screen.Login -> {
            val controller = remember(nav) {
                LoginController(
                    authApi = authApi,
                    tokenStorage = tokenStorage,
                    onLoggedIn = { nav.onLoggedIn() },
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
            val scope = androidx.compose.runtime.rememberCoroutineScope()
            DashboardScreen(
                state = state,
                onSelect = { project -> nav.navigateTo(Screen.TerminalList(project)) },
                onSignOut = {
                    tokenStorage.clear()
                    nav.signOut()
                },
                onRetry = { scope.launch { controller.load() } },
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
            val scope = androidx.compose.runtime.rememberCoroutineScope()
            TerminalListScreen(
                state = state,
                onSelect = { terminal ->
                    val terminals = (state as? TerminalListState.Loaded)?.terminals ?: listOf(terminal)
                    nav.navigateTo(Screen.Terminal(current.project, terminal, terminals))
                },
                onBack = { nav.back() },
                onRetry = { scope.launch { controller.load() } },
            )
        }
        is Screen.Terminal -> {
            val token = tokenStorage.read()
            if (token == null) {
                onUnauthorized()
            } else {
                // Single-terminal host until Phase 5's swipe-pager lands;
                // the pager wraps this and is wired in slice 9.
                TerminalPagerHost(
                    project = current.project,
                    terminals = current.terminals,
                    initialTerminal = current.terminal,
                    serverBaseUrl = serverUrl,
                    httpClient = authedClient,
                    token = token,
                    fontSizeStore = fontSizeStore,
                    onBack = { nav.back() },
                )
            }
        }
    }
}

@Composable
private fun TerminalPagerHost(
    project: com.dancode.android.projects.Project,
    terminals: List<com.dancode.android.terminal.TerminalSummary>,
    initialTerminal: com.dancode.android.terminal.TerminalSummary,
    serverBaseUrl: String,
    httpClient: OkHttpClient,
    token: String,
    fontSizeStore: TerminalFontSizeStore,
    onBack: () -> Unit,
) {
    // Pager wiring (slice 9). For now this is a single-terminal host.
    TerminalHost(
        terminal = initialTerminal,
        serverBaseUrl = serverBaseUrl,
        httpClient = httpClient,
        token = token,
        fontSizeStore = fontSizeStore,
        onBack = onBack,
    )
}
