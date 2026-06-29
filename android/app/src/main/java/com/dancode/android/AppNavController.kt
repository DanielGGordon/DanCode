package com.dancode.android

import com.dancode.android.projects.Project
import com.dancode.android.terminal.TerminalSummary
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Three-level navigation stack plus the login screen above it.
 *
 * `Terminal` carries the *sibling* terminal list so that the Compose layer
 * can render a HorizontalPager across the project's terminals without
 * re-fetching when the user swipes (Phase 5, swipe between siblings).
 */
sealed class Screen {
    data object Login : Screen()
    data object Dashboard : Screen()
    data class TerminalList(val project: Project) : Screen()
    data class Terminal(
        val project: Project,
        val terminal: TerminalSummary,
        val terminals: List<TerminalSummary> = listOf(terminal),
    ) : Screen()
}

/**
 * Headless navigation state holder. Owns the current screen, the back
 * stack (implicit via the screen hierarchy), and — most importantly — the
 * "pending destination" used to resume the user's intended screen after a
 * forced re-login (acceptance criterion 4).
 *
 * Kept off the UI layer so the navigation contract can be exercised by a
 * plain JUnit test (no Robolectric needed) and so the same controller can
 * survive configuration changes.
 */
class AppNavController(initialHasToken: Boolean) {
    private val _state = MutableStateFlow<Screen>(
        if (initialHasToken) Screen.Dashboard else Screen.Login,
    )
    val state: StateFlow<Screen> = _state.asStateFlow()

    private var pending: Screen? = null

    /** Inspectable for tests/UI; not load-bearing. */
    val pendingDestination: Screen? get() = pending

    fun navigateTo(screen: Screen) {
        _state.value = screen
    }

    /** Hierarchical back: Terminal → TerminalList → Dashboard → Login. */
    fun back() {
        _state.value = when (val current = _state.value) {
            is Screen.Terminal -> Screen.TerminalList(current.project)
            is Screen.TerminalList -> Screen.Dashboard
            Screen.Dashboard, Screen.Login -> Screen.Login
        }
    }

    /** Intentional sign-out; clears any pending destination. */
    fun signOut() {
        pending = null
        _state.value = Screen.Login
    }

    /**
     * Called by data-layer controllers when a 401 reaches them. The
     * *first* such call captures the destination so the user can resume
     * there after a successful re-login; subsequent 401s (other
     * controllers also blowing up) don't overwrite it with `Screen.Login`.
     */
    fun unauthorized() {
        val current = _state.value
        if (pending == null && current !is Screen.Login) {
            pending = current
        }
        _state.value = Screen.Login
    }

    /** Successful login resumes the pending destination, else the dashboard. */
    fun onLoggedIn() {
        _state.value = pending ?: Screen.Dashboard
        pending = null
    }
}
