package com.dancode.android.auth

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.collectAsState
import kotlinx.coroutines.launch

object LoginScreenTags {
    const val ROOT = "login-root"
    const val SERVER_URL = "login-server-url"
    const val USERNAME = "login-username"
    const val PASSWORD = "login-password"
    const val TOTP = "login-totp"
    const val SUBMIT = "login-submit"
    const val ERROR = "login-error"
    const val SUBMITTING = "login-submitting"
}

@Composable
fun LoginScreen(controller: LoginController) {
    val state by controller.state.collectAsState()
    val scope = rememberCoroutineScope()

    Surface(modifier = Modifier.fillMaxSize().testTag(LoginScreenTags.ROOT)) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(24.dp)
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(text = "DanCode")

            OutlinedTextField(
                value = state.serverUrl,
                onValueChange = controller::updateServerUrl,
                label = { Text("Server URL") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth().testTag(LoginScreenTags.SERVER_URL),
            )
            OutlinedTextField(
                value = state.username,
                onValueChange = controller::updateUsername,
                label = { Text("Username") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth().testTag(LoginScreenTags.USERNAME),
            )
            OutlinedTextField(
                value = state.password,
                onValueChange = controller::updatePassword,
                label = { Text("Password") },
                singleLine = true,
                visualTransformation = PasswordVisualTransformation(),
                modifier = Modifier.fillMaxWidth().testTag(LoginScreenTags.PASSWORD),
            )
            OutlinedTextField(
                value = state.totp,
                onValueChange = controller::updateTotp,
                label = { Text("TOTP code") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                visualTransformation = VisualTransformation.None,
                modifier = Modifier.fillMaxWidth().testTag(LoginScreenTags.TOTP),
            )

            Button(
                onClick = { scope.launch { controller.submit() } },
                enabled = !state.isSubmitting,
                modifier = Modifier.fillMaxWidth().testTag(LoginScreenTags.SUBMIT),
            ) {
                Text(text = if (state.isSubmitting) "Logging in…" else "Log in")
            }

            if (state.isSubmitting) {
                CircularProgressIndicator(modifier = Modifier.testTag(LoginScreenTags.SUBMITTING))
            }

            state.errorMessage?.let { message ->
                Text(text = message, modifier = Modifier.testTag(LoginScreenTags.ERROR))
            }
        }
    }
}
