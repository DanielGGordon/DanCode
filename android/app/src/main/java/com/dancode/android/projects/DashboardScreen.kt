package com.dancode.android.projects

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp

object DashboardScreenTags {
    const val PROJECT_LIST = "dashboard-project-list"
    const val LOADING = "dashboard-loading"
    const val EMPTY = "dashboard-empty"
    const val PROJECT_ITEM_PREFIX = "dashboard-project-item:"
}

sealed class DashboardState {
    data object Loading : DashboardState()
    data class Loaded(val projects: List<Project>) : DashboardState()
    data class Error(val message: String) : DashboardState()
}

@Composable
fun DashboardScreen(
    state: DashboardState,
    onSelect: (Project) -> Unit = {},
) {
    Surface(modifier = Modifier.fillMaxSize()) {
        when (state) {
            DashboardState.Loading -> LoadingPane()
            is DashboardState.Loaded -> if (state.projects.isEmpty()) {
                EmptyPane()
            } else {
                ProjectList(state.projects, onSelect)
            }
            is DashboardState.Error -> ErrorPane(state.message)
        }
    }
}

@Composable
private fun LoadingPane() {
    Box(
        modifier = Modifier.fillMaxSize(),
        contentAlignment = Alignment.Center,
    ) {
        CircularProgressIndicator(modifier = Modifier.testTag(DashboardScreenTags.LOADING))
    }
}

@Composable
private fun EmptyPane() {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp)
            .testTag(DashboardScreenTags.EMPTY),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text(text = "No projects yet")
    }
}

@Composable
private fun ProjectList(projects: List<Project>, onSelect: (Project) -> Unit) {
    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp)
            .testTag(DashboardScreenTags.PROJECT_LIST),
    ) {
        items(items = projects, key = { it.slug }) { project ->
            ProjectRow(project, onSelect)
            HorizontalDivider()
        }
    }
}

@Composable
private fun ProjectRow(project: Project, onSelect: (Project) -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .testTag(DashboardScreenTags.PROJECT_ITEM_PREFIX + project.slug)
            .clickable { onSelect(project) }
            .padding(vertical = 12.dp),
    ) {
        Text(text = project.name)
        if (project.path.isNotBlank()) {
            Text(text = project.path)
        }
    }
}

@Composable
private fun ErrorPane(message: String) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text(text = message)
    }
}
