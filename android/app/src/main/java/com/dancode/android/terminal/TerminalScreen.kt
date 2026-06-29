package com.dancode.android.terminal

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.OutlinedButton
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
    const val KEY_BAR = "terminal-screen-key-bar"
    const val OVERRIDE_TOGGLE = "terminal-screen-override-toggle"

    /** Stable test tag for each control-key button. */
    fun keyTag(key: ControlKey): String = "terminal-screen-key-${key.name}"
}

/**
 * Full-screen terminal view: header with back, embedded [terminalContent]
 * (the vendored TerminalView at runtime, a stub in tests), a control key
 * bar that emits raw byte sequences (Esc / arrows / Enter / Ctrl+C / Tab /
 * Shift+Tab), the cooked-mode input row (only usable when [inputMode] is
 * [InputMode.Cooked] and the connection is up), the override-mode toggle,
 * and a "reconnecting" overlay surfaced when the [TerminalConnection.State]
 * machine reports Reconnecting.
 *
 * @param state    five-state connection machine; gates input + overlay.
 * @param inputMode resolved input mode (auto or user-forced); when Raw,
 *                  the cooked text field is disabled so keystrokes go via
 *                  the key bar / soft-keyboard passthrough.
 * @param manualOverride the user's current override (null = Auto). The
 *                       toggle cycles Auto → Cooked → Raw → Auto.
 * @param onKey   invoked when a key-bar button is tapped — production
 *                handler turns this into `connection.sendRaw(key.bytes)`.
 * @param onSetManualOverride invoked when the override toggle is tapped,
 *                            with the next override value.
 */
@Composable
fun TerminalScreen(
    state: TerminalConnection.State,
    label: String,
    onSend: (String) -> Unit,
    onBack: () -> Unit,
    terminalContent: @Composable () -> Unit,
    inputMode: InputMode = InputMode.Cooked,
    manualOverride: InputMode? = null,
    onKey: (ControlKey) -> Unit = {},
    onSetManualOverride: (InputMode?) -> Unit = {},
) {
    val connected = state == TerminalConnection.State.Connected
    Surface(modifier = Modifier.fillMaxSize().testTag(TerminalScreenTags.ROOT)) {
        Column(modifier = Modifier.fillMaxSize()) {
            HeaderBar(
                label = label,
                onBack = onBack,
                manualOverride = manualOverride,
                onSetManualOverride = onSetManualOverride,
            )
            Box(modifier = Modifier.fillMaxWidth().weight(1f)) {
                terminalContent()
                if (state == TerminalConnection.State.Reconnecting) {
                    ReconnectingOverlay()
                }
            }
            KeyBar(enabled = connected, onKey = onKey)
            InputRow(
                onSend = onSend,
                enabled = connected && inputMode == InputMode.Cooked,
            )
        }
    }
}

@Composable
private fun HeaderBar(
    label: String,
    onBack: () -> Unit,
    manualOverride: InputMode?,
    onSetManualOverride: (InputMode?) -> Unit,
) {
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
        Text(text = label, modifier = Modifier.padding(start = 8.dp).weight(1f))
        OverrideToggle(manualOverride = manualOverride, onSetManualOverride = onSetManualOverride)
    }
}

@Composable
private fun OverrideToggle(manualOverride: InputMode?, onSetManualOverride: (InputMode?) -> Unit) {
    val labelText = when (manualOverride) {
        null -> "Mode: Auto"
        InputMode.Cooked -> "Mode: Cooked"
        InputMode.Raw -> "Mode: Raw"
    }
    OutlinedButton(
        onClick = { onSetManualOverride(nextOverride(manualOverride)) },
        modifier = Modifier.testTag(TerminalScreenTags.OVERRIDE_TOGGLE),
    ) { Text(labelText) }
}

private fun nextOverride(current: InputMode?): InputMode? = when (current) {
    null -> InputMode.Cooked
    InputMode.Cooked -> InputMode.Raw
    InputMode.Raw -> null
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
private fun KeyBar(enabled: Boolean, onKey: (ControlKey) -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 8.dp, vertical = 4.dp)
            .horizontalScroll(rememberScrollState())
            .testTag(TerminalScreenTags.KEY_BAR),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        for (key in ControlKey.entries) {
            OutlinedButton(
                onClick = { onKey(key) },
                enabled = enabled,
                // 44dp meets the mobile tap-target floor.
                modifier = Modifier
                    .sizeIn(minWidth = 44.dp, minHeight = 44.dp)
                    .testTag(TerminalScreenTags.keyTag(key)),
            ) { Text(key.label) }
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
