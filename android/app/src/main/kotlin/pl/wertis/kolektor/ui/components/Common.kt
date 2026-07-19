package pl.wertis.kolektor.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import pl.wertis.kolektor.core.net.ProductRow
import pl.wertis.kolektor.scan.WedgeKeySource
import pl.wertis.kolektor.ui.theme.Amber
import pl.wertis.kolektor.ui.theme.AmberBg
import pl.wertis.kolektor.ui.theme.AmberInk
import pl.wertis.kolektor.ui.theme.BarlowCond
import pl.wertis.kolektor.ui.theme.BorderCol
import pl.wertis.kolektor.ui.theme.CardWhite
import pl.wertis.kolektor.ui.theme.Ink
import pl.wertis.kolektor.ui.theme.InkMute
import pl.wertis.kolektor.ui.theme.InkSoft

/* ── Wspólne klocki UI (odpowiedniki shadcn + komponentów web/) ──────────── */

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
    imeAction: ImeAction = ImeAction.Done,
    onDone: () -> Unit = {},
) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        modifier = modifier
            .fillMaxWidth()
            .onFocusChanged { WedgeKeySource.textFieldFocused = it.isFocused },
        placeholder = { Text(placeholder, color = InkMute) },
        singleLine = true,
        shape = RoundedCornerShape(10.dp),
        keyboardOptions = KeyboardOptions(imeAction = imeAction),
        keyboardActions = androidx.compose.foundation.text.KeyboardActions(
            onDone = { onDone() },
            onSearch = { onDone() },
        ),
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
    onClick: () -> Unit,
) {
    Box(
        modifier = modifier
            .clip(RoundedCornerShape(10.dp))
            .background(if (enabled) Amber else Amber.copy(alpha = 0.4f))
            .clickable(enabled = enabled, onClick = onClick)
            .padding(horizontal = 16.dp, vertical = if (tall) 14.dp else 10.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text,
            color = Ink,
            fontFamily = BarlowCond,
            fontWeight = FontWeight.ExtraBold,
            fontSize = if (tall) 17.sp else 15.sp,
            letterSpacing = 0.5.sp,
            textAlign = TextAlign.Center,
        )
    }
}

@Composable
fun OutlineButton(
    text: String,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    tall: Boolean = false,
    danger: Boolean = false,
    onClick: () -> Unit,
) {
    val color = if (danger) MaterialTheme.colorScheme.error else Ink
    Box(
        modifier = modifier
            .clip(RoundedCornerShape(10.dp))
            .border(1.5.dp, if (enabled) color.copy(alpha = 0.7f) else BorderCol, RoundedCornerShape(10.dp))
            .background(CardWhite)
            .clickable(enabled = enabled, onClick = onClick)
            .padding(horizontal = 14.dp, vertical = if (tall) 14.dp else 9.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text,
            color = if (enabled) color else InkMute,
            fontFamily = BarlowCond,
            fontWeight = FontWeight.Bold,
            fontSize = 15.sp,
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
            .clip(RoundedCornerShape(10.dp))
            .border(1.dp, BorderCol, RoundedCornerShape(10.dp))
            .background(CardWhite)
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
        color = InkMute,
    )
}

@Composable
fun LoadingRow(text: String = "Wczytywanie…") {
    Row(
        modifier = Modifier.fillMaxWidth().padding(20.dp),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(text, color = InkMute, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
    }
}

/** Wiersz wyniku wyszukiwania / zawartości lokalizacji (ProductRow). */
@Composable
fun ProductRowCard(row: ProductRow, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .border(1.dp, BorderCol, RoundedCornerShape(10.dp))
            .background(CardWhite)
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 9.dp),
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

/** Chip lokalizacji (pierwsza = pickingowa, z bursztynową kropką). */
@Composable
fun LocChip(code: String, primary: Boolean, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .clip(RoundedCornerShape(50))
            .border(1.5.dp, Ink, RoundedCornerShape(50))
            .background(if (primary) Ink else CardWhite)
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 7.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        if (primary) Box(Modifier.size(7.dp).clip(CircleShape).background(Amber))
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
