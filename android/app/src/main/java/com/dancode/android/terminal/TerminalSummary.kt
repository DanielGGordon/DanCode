package com.dancode.android.terminal

/**
 * Minimal per-terminal record the Phase 3 UI needs. Extra fields the
 * server emits (`createdAt`, `lastActivity`, `claudeSessionId`,
 * `claudeActive`, `background`, …) are ignored at this layer and will be
 * added as later phases surface them.
 */
data class TerminalSummary(
    val id: String,
    val projectSlug: String,
    val label: String,
    val command: String?,
    val cwd: String?,
)
