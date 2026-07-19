package pl.wertis.kolektor.ui.theme

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.dp

/* Jasny motyw WERTIS (bursztyn/grafit/papier) — brak trybu ciemnego,
   tak jak w PWA. Promień bazowy 12dp (--radius: 0.75rem). */

private val WertisColorScheme = lightColorScheme(
    primary = Amber,
    onPrimary = Ink,
    primaryContainer = AmberBg,
    onPrimaryContainer = AmberInk,
    secondary = Secondary,
    onSecondary = Ink,
    secondaryContainer = Secondary,
    onSecondaryContainer = Ink,
    background = Paper,
    onBackground = Ink,
    surface = CardWhite,
    onSurface = Ink,
    surfaceVariant = Muted,
    onSurfaceVariant = InkSoft,
    outline = BorderCol,
    outlineVariant = BorderCol,
    error = Destructive,
    onError = CardWhite,
    errorContainer = Destructive.copy(alpha = 0.1f),
    onErrorContainer = Destructive,
)

private val WertisShapes = Shapes(
    extraSmall = RoundedCornerShape(6.dp),
    small = RoundedCornerShape(8.dp),
    medium = RoundedCornerShape(12.dp),
    large = RoundedCornerShape(16.dp),
    extraLarge = RoundedCornerShape(20.dp),
)

@Composable
fun WertisTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = WertisColorScheme,
        typography = WertisTypography,
        shapes = WertisShapes,
        content = content,
    )
}
