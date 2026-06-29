package com.dancode.android.terminal

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp

object TerminalScreenTags {
    const val ROOT = "terminal-screen"
    const val BACK = "terminal-screen-back"
    const val INPUT = "terminal-screen-input"
    const val SEND = "terminal-screen-send"
    const val RECONNECTING_OVERLAY = "terminal-screen-reconnecting"
}

/**
 * Full-screen terminal view: header with back, embedded [terminalContent]
 * (the vendored TerminalView at runtime, a stub in tests), cooked-mode
 * input row at the bottom, and a "reconnecting" overlay surfaced when the
 * [TerminalConnection.State] machine reports Reconnecting.
 */
@Composable
fun TerminalScreen(
    state: TerminalConnection.State,
    label: String,
    onSend: (String) -> Unit,
    onBack: () -> Unit,
    terminalContent: @Composable () -> Unit,
) {
    Surface(modifier = Modifier.fillMaxSize().testTag(TerminalScreenTags.ROOT)) {
        Column(modifier = Modifier.fillMaxSize()) {
            HeaderBar(label = label, onBack = onBack)
            Box(modifier = Modifier.fillMaxWidth().weight(1f)) {
                terminalContent()
                if (state == TerminalConnection.State.Reconnecting) {
                    ReconnectingOverlay()
                }
            }
            InputRow(onSend = onSend, enabled = state == TerminalConnection.State.Connected)
        }
    }
}

@Composable
private fun HeaderBar(label: String, onBack: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        TextButton(
            onClick = onBack,
            modifier = Modifier.testTag(TerminalScreenTags.BACK),
        ) { Text("Back") }
        Text(text = label, modifier = Modifier.padding(start = 8.dp))
    }
}

@Composable
private fun ReconnectingOverlay() {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0x99000000))
            .testTag(TerminalScreenTags.RECONNECTING_OVERLAY),
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            CircularProgressIndicator(color = Color.White)
            Text(text = "Reconnecting…", color = Color.White, modifier = Modifier.padding(top = 8.dp))
        }
    }
}

@Composable
private fun InputRow(onSend: (String) -> Unit, enabled: Boolean) {
    var text by remember { mutableStateOf("") }
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(8.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        OutlinedTextField(
            value = text,
            onValueChange = { text = it },
            modifier = Modifier
                .weight(1f)
                .testTag(TerminalScreenTags.INPUT),
            singleLine = true,
            label = { Text("Send a line") },
            enabled = enabled,
        )
        Button(
            onClick = {
                if (enabled) {
                    onSend(text)
                    text = ""
                }
            },
            enabled = enabled,
            modifier = Modifier.testTag(TerminalScreenTags.SEND),
        ) { Text("Send") }
    }
}
