package com.dancode.android.terminal

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

object TerminalListScreenTags {
    const val LIST = "terminal-list"
    const val LOADING = "terminal-list-loading"
    const val EMPTY = "terminal-list-empty"
    const val ITEM_PREFIX = "terminal-list-item:"
}

@Composable
fun TerminalListScreen(
    state: TerminalListState,
    onSelect: (TerminalSummary) -> Unit,
) {
    Surface(modifier = Modifier.fillMaxSize()) {
        when (state) {
            TerminalListState.Loading -> LoadingPane()
            is TerminalListState.Loaded -> if (state.terminals.isEmpty()) {
                EmptyPane()
            } else {
                TerminalRows(state.terminals, onSelect)
            }
            is TerminalListState.Error -> ErrorPane(state.message)
        }
    }
}

@Composable
private fun LoadingPane() {
    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        CircularProgressIndicator(modifier = Modifier.testTag(TerminalListScreenTags.LOADING))
    }
}

@Composable
private fun EmptyPane() {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp)
            .testTag(TerminalListScreenTags.EMPTY),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text(text = "No terminals in this project yet")
    }
}

@Composable
private fun TerminalRows(
    terminals: List<TerminalSummary>,
    onSelect: (TerminalSummary) -> Unit,
) {
    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp)
            .testTag(TerminalListScreenTags.LIST),
    ) {
        items(items = terminals, key = { it.id }) { terminal ->
            TerminalRow(terminal, onSelect)
            HorizontalDivider()
        }
    }
}

@Composable
private fun TerminalRow(
    terminal: TerminalSummary,
    onSelect: (TerminalSummary) -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .testTag(TerminalListScreenTags.ITEM_PREFIX + terminal.id)
            .clickable { onSelect(terminal) }
            .padding(vertical = 12.dp),
    ) {
        Text(text = terminal.label)
        terminal.command?.takeIf { it.isNotBlank() }?.let { Text(text = it) }
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
