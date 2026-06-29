package com.dancode.android.projects

/**
 * Minimal project record needed by the dashboard. The server returns more
 * fields (createdAt, layout, terminals, …) — we ignore them at this layer
 * and let later phases add them as needed.
 */
data class Project(
    val name: String,
    val slug: String,
    val path: String,
)
