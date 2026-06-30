package com.dancode.android

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

/**
 * Solarized Dark palette for the Android app. The app is always dark —
 * Solarized Light is a desktop-web-only option. The bare `MaterialTheme {}`
 * the app shipped with defaulted to Material3's *light* scheme (white
 * background, barely-legible text); this forces the Solarized Dark tones.
 *
 * Reference values (Ethan Schoonover's Solarized):
 *   base03 #002b36  base02 #073642  base01 #586e75  base00 #657b83
 *   base0  #839496  base1  #93a1a1  base2  #eee8d5  base3  #fdf6e3
 *   yellow #b58900  orange #cb4b16  red #dc322f  magenta #d33682
 *   violet #6c71c4  blue #268bd2    cyan #2aa198  green #859900
 */
private val Base03 = Color(0xFF002B36)
private val Base02 = Color(0xFF073642)
private val Base01 = Color(0xFF586E75)
private val Base00 = Color(0xFF657B83)
private val Base0 = Color(0xFF839496)
private val Base1 = Color(0xFF93A1A1)
private val Base2 = Color(0xFFEEE8D5)
private val Blue = Color(0xFF268BD2)
private val Cyan = Color(0xFF2AA198)
private val Red = Color(0xFFDC322F)

private val SolarizedDarkColors = darkColorScheme(
    primary = Blue,
    onPrimary = Base03,
    primaryContainer = Base02,
    onPrimaryContainer = Base2,
    secondary = Cyan,
    onSecondary = Base03,
    background = Base03,
    onBackground = Base0,
    surface = Base03,
    onSurface = Base0,
    surfaceVariant = Base02,
    onSurfaceVariant = Base1,
    outline = Base01,
    outlineVariant = Base01,
    error = Red,
    onError = Base03,
)

@Composable
fun DanCodeTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = SolarizedDarkColors, content = content)
}
