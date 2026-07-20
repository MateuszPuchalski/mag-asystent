package pl.wertis.kolektor.ui.components

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.ripple
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import pl.wertis.kolektor.core.net.ProductRow
import pl.wertis.kolektor.scan.WedgeKeySource
import pl.wertis.kolektor.ui.theme.Amber
import pl.wertis.kolektor.ui.theme.AmberBg
import pl.wertis.kolektor.ui.theme.AmberDark
import pl.wertis.kolektor.ui.theme.AmberInk
import pl.wertis.kolektor.ui.theme.BarlowCond
import pl.wertis.kolektor.ui.theme.BorderCol
import pl.wertis.kolektor.ui.theme.CardBorder
import pl.wertis.kolektor.ui.theme.CardShape
import pl.wertis.kolektor.ui.theme.CardWhite
import pl.wertis.kolektor.ui.theme.Ink
import pl.wertis.kolektor.ui.theme.InkMute
import pl.wertis.kolektor.ui.theme.InkSoft
import pl.wertis.kolektor.ui.theme.Secondary
import pl.wertis.kolektor.ui.theme.ShadowInk
import pl.wertis.kolektor.ui.theme.cardSurface

/* ── Wspólne klocki UI (odpowiedniki shadcn + komponentów web/) ──────────────
   Po odświeżeniu: głębia (cień), ikony, cele dotyku ≥48dp, stan wciśnięcia,
   szkielety ładowania. Kolory szarości przyciemnione do WCAG AA na papierze. */

private val MinTap = 48.dp

/**
 * Pole tekstowe zgłaszające fokus do WedgeKeySource — gdy pole jest aktywne,
 * wedge nie przechwytuje klawiszy (pole samo obsłuży Enter), jak w PWA.
 */
@Composable
fun WertisTextField(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    placeholder: String = "",
    leadingIcon: ImageVector? = null,
    imeAction: ImeAction = ImeAction.Done,
    onDone: () -> Unit = {},
) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        modifier = modifier
            .fillMaxWidth()
            .heightIn(min = MinTap)
            .onFocusChanged { WedgeKeySource.textFieldFocused = it.isFocused },
        placeholder = { Text(placeholder, color = InkMute) },
        leadingIcon = leadingIcon?.let { { Icon(it, null, tint = InkMute, modifier = Modifier.size(18.dp)) } },
        singleLine = true,
        shape = RoundedCornerShape(12.dp),
        keyboardOptions = KeyboardOptions(imeAction = imeAction),
        keyboardActions = KeyboardActions(onDone = { onDone() }, onSearch = { onDone() }),
        colors = OutlinedTextFieldDefaults.colors(
            focusedBorderColor = Amber,
            unfocusedBorderColor = BorderCol,
            focusedContainerColor = CardWhite,
            unfocusedContainerColor = CardWhite,
        ),
    )
}

@Composable
fun PrimaryButton(
    text: String,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    tall: Boolean = false,
    leadingIcon: ImageVector? = null,
    onClick: () -> Unit,
) {
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val shape = RoundedCornerShape(12.dp)
    val bg = when {
        !enabled -> Amber.copy(alpha = 0.4f)
        pressed -> AmberDark
        else -> Amber
    }
    Box(
        modifier = modifier
            .shadow(if (enabled) 3.dp else 0.dp, shape, clip = false, ambientColor = ShadowInk, spotColor = ShadowInk)
            .clip(shape)
            .background(bg)
            .defaultMinSize(minHeight = MinTap)
            .clickable(enabled = enabled, interactionSource = interaction, indication = ripple(color = Ink), onClick = onClick)
            .padding(horizontal = 16.dp, vertical = if (tall) 14.dp else 11.dp),
        contentAlignment = Alignment.Center,
    ) {
        ButtonContent(text, leadingIcon, Ink, if (tall) 17.sp else 15.sp, FontWeight.ExtraBold)
    }
}

@Composable
fun OutlineButton(
    text: String,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    tall: Boolean = false,
    danger: Boolean = false,
    leadingIcon: ImageVector? = null,
    onClick: () -> Unit,
) {
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val color = if (danger) MaterialTheme.colorScheme.error else Ink
    val shape = RoundedCornerShape(12.dp)
    Box(
        modifier = modifier
            .shadow(if (enabled) 2.dp else 0.dp, shape, clip = false, ambientColor = ShadowInk, spotColor = ShadowInk)
            .clip(shape)
            .background(if (pressed && enabled) Secondary else CardWhite)
            .border(1.5.dp, if (enabled) color.copy(alpha = 0.55f) else BorderCol, shape)
            .defaultMinSize(minHeight = MinTap)
            .clickable(enabled = enabled, interactionSource = interaction, indication = ripple(color = color), onClick = onClick)
            .padding(horizontal = 14.dp, vertical = if (tall) 14.dp else 10.dp),
        contentAlignment = Alignment.Center,
    ) {
        ButtonContent(text, leadingIcon, if (enabled) color else InkMute, 15.sp, FontWeight.Bold)
    }
}

@Composable
private fun ButtonContent(text: String, icon: ImageVector?, color: Color, size: androidx.compose.ui.unit.TextUnit, weight: FontWeight) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        icon?.let { Icon(it, null, tint = color, modifier = Modifier.size(18.dp)) }
        Text(
            text,
            color = color,
            fontFamily = BarlowCond,
            fontWeight = weight,
            fontSize = size,
            letterSpacing = 0.5.sp,
            textAlign = TextAlign.Center,
        )
    }
}

@Composable
fun SectionCard(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .cardSurface()
            .padding(horizontal = 12.dp, vertical = 10.dp),
        content = content,
    )
}

@Composable
fun SectionLabel(text: String) {
    Text(
        text.uppercase(),
        fontSize = 11.sp,
        fontWeight = FontWeight.Bold,
        letterSpacing = 1.2.sp,
        color = InkSoft,
    )
}

/* ── Szkielet ładowania (shimmer) — zastępuje goły napis „Wczytywanie…". ──── */

private val SkelBase = Color(0xFFECEAE3)
private val SkelHi = Color(0xFFF6F4EE)

@Composable
private fun shimmerBrush(): Brush {
    val tr = rememberInfiniteTransition(label = "sk")
    val x by tr.animateFloat(
        initialValue = -400f,
        targetValue = 800f,
        animationSpec = infiniteRepeatable(tween(1300, easing = LinearEasing)),
        label = "skx",
    )
    return Brush.linearGradient(
        colors = listOf(SkelBase, SkelHi, SkelBase),
        start = Offset(x, 0f),
        end = Offset(x + 400f, 0f),
    )
}

@Composable
fun SkeletonBar(widthFraction: Float, height: Dp = 12.dp, modifier: Modifier = Modifier) {
    Box(
        modifier
            .fillMaxWidth(widthFraction)
            .height(height)
            .clip(RoundedCornerShape(6.dp))
            .background(shimmerBrush()),
    )
}

/** Placeholder listy/karty w trakcie ładowania. */
@Composable
fun LoadingRow(text: String = "Wczytywanie…") {
    Column(
        modifier = Modifier.fillMaxWidth().padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(9.dp),
    ) {
        SkeletonBar(0.7f, 14.dp)
        SkeletonBar(0.45f, 11.dp)
        SkeletonBar(0.55f, 11.dp)
    }
}

/** Wiersz wyniku wyszukiwania / zawartości lokalizacji (ProductRow). */
@Composable
fun ProductRowCard(row: ProductRow, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .cardSurface()
            .heightIn(min = MinTap)
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(row.sym, fontFamily = BarlowCond, fontWeight = FontWeight.Bold, fontSize = 15.sp, color = Ink)
            Text(
                row.name,
                fontSize = 12.sp,
                color = InkSoft,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (row.locs.isNotEmpty()) {
                Text(row.locs.joinToString(" "), fontSize = 11.sp, color = InkMute, maxLines = 1)
            }
        }
        Column(horizontalAlignment = Alignment.End) {
            Text(
                formatQty(row.mag),
                fontFamily = BarlowCond,
                fontWeight = FontWeight.ExtraBold,
                fontSize = 18.sp,
                color = Ink,
            )
            if (row.mgp > 0) {
                Text(
                    "MGP ${formatQty(row.mgp)}",
                    fontSize = 11.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = AmberInk,
                    modifier = Modifier
                        .clip(RoundedCornerShape(6.dp))
                        .background(AmberBg)
                        .padding(horizontal = 5.dp, vertical = 1.dp),
                )
            }
        }
    }
}

/** Chip lokalizacji (pierwsza = pickingowa, z bursztynową kropką; reszta z pinezką). */
@Composable
fun LocChip(code: String, primary: Boolean, onClick: () -> Unit) {
    val shape = RoundedCornerShape(50)
    Row(
        modifier = Modifier
            .shadow(2.dp, shape, clip = false, ambientColor = ShadowInk, spotColor = ShadowInk)
            .clip(shape)
            .border(1.5.dp, Ink, shape)
            .background(if (primary) Ink else CardWhite)
            .heightIn(min = 44.dp)
            .clickable(onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        if (primary) {
            Box(Modifier.size(7.dp).clip(CircleShape).background(Amber))
        } else {
            Icon(WIcons.Pin, null, tint = Ink, modifier = Modifier.size(14.dp))
        }
        Text(
            code,
            fontFamily = BarlowCond,
            fontWeight = FontWeight.Bold,
            fontSize = 15.sp,
            color = if (primary) Color.White else Ink,
        )
    }
}

/** Liczby ilości: bez `.0` dla całkowitych (JS number → Double). */
fun formatQty(v: Double): String =
    if (v == v.toLong().toDouble()) v.toLong().toString() else v.toString()
