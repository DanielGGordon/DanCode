package com.dancode.android

import com.dancode.android.projects.Project
import com.dancode.android.terminal.TerminalSummary
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Acceptance criterion 4: "Token expiry routes to re-login preserving the
 * intended destination". The controller is the headless contract — once
 * proven, the Compose layer wires through it.
 */
class AppNavControllerTest {

    private val project = Project(name = "DanCode", slug = "dancode", path = "/p")
    private val terminal = TerminalSummary(
        id = "t-1",
        projectSlug = "dancode",
        label = "CLI",
        command = "bash",
        cwd = "/p",
    )

    @Test
    fun initial_screen_is_login_when_no_token() {
        val nav = AppNavController(initialHasToken = false)
        assertTrue(nav.state.value is Screen.Login)
    }

    @Test
    fun initial_screen_is_dashboard_when_token_present() {
        val nav = AppNavController(initialHasToken = true)
        assertEquals(Screen.Dashboard, nav.state.value)
    }

    @Test
    fun navigateTo_changes_current_screen() {
        val nav = AppNavController(initialHasToken = true)
        nav.navigateTo(Screen.TerminalList(project))
        assertEquals(Screen.TerminalList(project), nav.state.value)
    }

    @Test
    fun back_from_terminal_returns_to_terminal_list() {
        val nav = AppNavController(initialHasToken = true)
        nav.navigateTo(Screen.TerminalList(project))
        nav.navigateTo(Screen.Terminal(project, terminal, listOf(terminal)))
        nav.back()
        assertEquals(Screen.TerminalList(project), nav.state.value)
    }

    @Test
    fun back_from_terminal_list_returns_to_dashboard() {
        val nav = AppNavController(initialHasToken = true)
        nav.navigateTo(Screen.TerminalList(project))
        nav.back()
        assertEquals(Screen.Dashboard, nav.state.value)
    }

    @Test
    fun back_from_dashboard_goes_to_login() {
        val nav = AppNavController(initialHasToken = true)
        nav.back()
        assertTrue(nav.state.value is Screen.Login)
    }

    @Test
    fun unauthorized_routes_to_login_and_preserves_destination() {
        val nav = AppNavController(initialHasToken = true)
        val target = Screen.Terminal(project, terminal, listOf(terminal))
        nav.navigateTo(target)
        nav.unauthorized()
        assertTrue(nav.state.value is Screen.Login)
        nav.onLoggedIn()
        assertEquals(target, nav.state.value)
    }

    @Test
    fun unauthorized_from_dashboard_resumes_at_dashboard_after_login() {
        val nav = AppNavController(initialHasToken = true)
        nav.unauthorized()
        assertTrue(nav.state.value is Screen.Login)
        nav.onLoggedIn()
        assertEquals(Screen.Dashboard, nav.state.value)
    }

    @Test
    fun onLoggedIn_defaults_to_dashboard_when_no_pending() {
        val nav = AppNavController(initialHasToken = false)
        nav.onLoggedIn()
        assertEquals(Screen.Dashboard, nav.state.value)
    }

    @Test
    fun signOut_clears_pending_and_returns_to_login() {
        val nav = AppNavController(initialHasToken = true)
        nav.navigateTo(Screen.TerminalList(project))
        nav.signOut()
        assertTrue(nav.state.value is Screen.Login)
        // After signing out and logging back in, we should NOT resume the
        // pre-sign-out screen — sign-out is an intentional reset.
        nav.onLoggedIn()
        assertEquals(Screen.Dashboard, nav.state.value)
    }

    @Test
    fun consecutive_unauthorized_calls_keep_the_first_pending() {
        // Several screens may all surface a 401 in quick succession (the
        // dashboard + a terminal list both polling). Only the first one's
        // origin matters — subsequent calls happen on the way to login.
        val nav = AppNavController(initialHasToken = true)
        nav.navigateTo(Screen.TerminalList(project))
        nav.unauthorized()
        // A second 401 while already routed to login (e.g. background
        // controller) shouldn't overwrite the recovered destination with
        // Screen.Login.
        nav.unauthorized()
        nav.onLoggedIn()
        assertEquals(Screen.TerminalList(project), nav.state.value)
    }

    @Test
    fun pending_destination_is_consumed_only_once() {
        val nav = AppNavController(initialHasToken = true)
        nav.navigateTo(Screen.TerminalList(project))
        nav.unauthorized()
        nav.onLoggedIn()
        assertEquals(Screen.TerminalList(project), nav.state.value)
        // Manual sign-out from this resumed screen, then login again →
        // pending is gone, we go to Dashboard.
        nav.signOut()
        nav.onLoggedIn()
        assertEquals(Screen.Dashboard, nav.state.value)
    }

    @Test
    fun login_pending_is_null_by_default() {
        // Diagnostic: when no destination is pending the controller still
        // exposes pendingDestination as null.
        val nav = AppNavController(initialHasToken = false)
        assertNull(nav.pendingDestination)
    }
}
