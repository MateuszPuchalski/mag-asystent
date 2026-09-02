package pl.wertis.kolektor.ui.components

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.RepeatMode
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
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import pl.wertis.kolektor.AppGraph
import pl.wertis.kolektor.core.net.ProductRow
import pl.wertis.kolektor.core.text.formatQty
import pl.wertis.kolektor.scan.WedgeKeySource
import pl.wertis.kolektor.ui.product.MiniaturaTowaru
import pl.wertis.kolektor.ui.theme.Amber
import pl.wertis.kolektor.ui.theme.AmberBg
import pl.wertis.kolektor.ui.theme.AmberDark
import pl.wertis.kolektor.ui.theme.AmberInk
import pl.wertis.kolektor.ui.theme.AmberLine
import pl.wertis.kolektor.ui.theme.BarlowCond
import androidx.compose.ui.text.style.TextDecoration
import pl.wertis.kolektor.ui.theme.BorderCol
import pl.wertis.kolektor.ui.theme.Destructive
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

/** Minimalny cel dotyku — jedno źródło dla wszystkich klocków (także Collapsible.kt). */
internal val MinTap = 48.dp

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
    keyboardType: KeyboardType = KeyboardType.Text,
    /** Maskowanie treści — hasło wpisuje się na hali, przy ludziach. */
    visualTransformation: VisualTransformation = VisualTransformation.None,
    onDone: () -> Unit = {},
    /** Zmiana fokusu — ekran bywa musi wiedzieć, że skaner właśnie milczy. */
    onFokus: (Boolean) -> Unit = {},
) {
    val focusManager = LocalFocusManager.current
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        modifier = modifier
            .fillMaxWidth()
            .heightIn(min = MinTap)
            .onFocusChanged {
                WedgeKeySource.ustawFokus(it.isFocused)
                onFokus(it.isFocused)
            },
        placeholder = { Text(placeholder, color = InkMute) },
        leadingIcon = leadingIcon?.let { { Icon(it, null, tint = InkMute, modifier = Modifier.size(18.dp)) } },
        singleLine = true,
        shape = RoundedCornerShape(12.dp),
        keyboardOptions = KeyboardOptions(keyboardType = keyboardType, imeAction = imeAction),
        visualTransformation = visualTransformation,
        /* Next przechodzi do pola niżej — formularz kilkupolowy bez zamykania
           i ponownego celowania w klawiaturę przy każdym polu. */
        /* „Gotowe" ODDAJE FOKUS, nie tylko chowa klawiaturę (0.66.0).
           W tej aplikacji pole z fokusem UCISZA SKANER — `WedgeKeySource`
           zbiera znaki tylko wtedy, gdy nie ma ich gdzie wpisać. Pole, które
           po „gotowe" trzyma fokus dalej, zostawia więc kolektor bez skanera,
           przy schowanej klawiaturze i bez śladu, dlaczego nic nie działa.
           Zgłoszenie z hali brzmiało dokładnie tak: „wyszukałem produkt i nie
           mogę nadać lokalizacji ani zatwierdzić skanem". */
        keyboardActions = KeyboardActions(
            onDone = { onDone(); focusManager.clearFocus() },
            onSearch = { onDone(); focusManager.clearFocus() },
            onNext = { focusManager.moveFocus(FocusDirection.Down) },
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
fun ProductRowCard(graph: AppGraph, row: ProductRow, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .cardSurface()
            .heightIn(min = MinTap)
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        MiniaturaTowaru(graph, row.id, 40.dp)
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
            // wypełniane wyłącznie przy zawartości regału — read-model pokazałby
            // stan sprzed zmiany, więc bez tego wiersz milczy o tym, co się dzieje
            when (row.pendingHere) {
                "add" -> PendingHereNote("⏳ jedzie tutaj — zapis w kolejce", false)
                "remove" -> PendingHereNote("⏳ schodzi stąd — zapis w kolejce", false)
                "error" -> PendingHereNote("⚠ zapis do Subiekta się nie udał", true)
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

@Composable
private fun PendingHereNote(text: String, alarm: Boolean) {
    Text(
        text,
        fontSize = 11.sp,
        fontWeight = FontWeight.SemiBold,
        color = if (alarm) Destructive else AmberInk,
        maxLines = 1,
    )
}

/**
 * Stan chipa lokalizacji względem Subiekta.
 *
 * Read-model aktualizuje się dopiero po udanym zapisie przez workera, więc
 * między skanem a potwierdzeniem karta pokazywałaby stan sprzed zmiany i nic
 * by o tym nie mówiła. Przy błędzie zapisu ten stan jest TRWAŁY — i tylko on
 * wymaga reakcji człowieka, dlatego tylko on pulsuje.
 */
enum class LocState { CONFIRMED, ADDING, REMOVING, FAILED }

/**
 * Chip lokalizacji (pierwsza = pickingowa, z bursztynową kropką; reszta z pinezką).
 *
 * `big` to pastylka adresu w nagłówku karty towaru. Świadomie ten sam
 * composable, a nie osobny widget: pastylka musi rysować DOKŁADNIE te same
 * cztery stany co chip (przekreślenie przy schodzącym, ⏳ przy dochodzącym,
 * czerwony puls przy nieudanym zapisie). Drugi widget znaczyłby, że stany
 * trzeba zaimplementować dwa razy — a wtedy rozjeżdżają się przy pierwszej
 * zmianie i nagłówek mówi co innego niż rząd chipów pod nim.
 */
@Composable
fun LocChip(
    code: String,
    primary: Boolean,
    state: LocState = LocState.CONFIRMED,
    big: Boolean = false,
    onClick: () -> Unit,
) {
    val shape = RoundedCornerShape(50)
    val failed = state == LocState.FAILED
    val waiting = state == LocState.ADDING || state == LocState.REMOVING

    // pulsuje WYŁĄCZNIE błąd — animacja na ekranie trzymanym otwartym cały dzień
    // kosztuje baterię i po godzinie staje się tłem, więc zostaje zarezerwowana
    // dla jedynego stanu, który wymaga działania
    val alpha = if (failed) {
        rememberInfiniteTransition(label = "loc-error").animateFloat(
            initialValue = 1f,
            targetValue = 0.45f,
            animationSpec = infiniteRepeatable(tween(700, easing = LinearEasing), RepeatMode.Reverse),
            label = "alpha",
        ).value
    } else if (waiting) 0.55f else 1f

    val border = when {
        failed -> Destructive
        waiting -> InkMute
        else -> Ink
    }
    val fill = if (primary && state == LocState.CONFIRMED) Ink else CardWhite
    val ink = when {
        failed -> Destructive
        primary && state == LocState.CONFIRMED -> Color.White
        else -> Ink
    }

    Row(
        modifier = Modifier
            .alpha(alpha)
            .then(
                // cień tylko na potwierdzonym: „w drodze" ma leżeć płasko,
                // żeby różnica była czytelna także w słońcu na hali
                if (state == LocState.CONFIRMED) {
                    Modifier.shadow(if (big) 3.dp else 2.dp, shape, clip = false, ambientColor = ShadowInk, spotColor = ShadowInk)
                } else Modifier
            )
            .clip(shape)
            .border(if (failed) 2.dp else 1.5.dp, border, shape)
            .background(fill)
            /* Wariant mały brał 44 dp i to była DRUGA liczba udająca „minimum
               dla palca" obok MinTap, w tym samym pliku. Jedno źródło znaczy
               jedno źródło. */
            .heightIn(min = if (big) 52.dp else MinTap)
            .clickable(onClick = onClick)
            .padding(horizontal = if (big) 16.dp else 14.dp, vertical = if (big) 12.dp else 9.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(if (big) 7.dp else 6.dp),
    ) {
        val ikona = if (big) 16.dp else 14.dp
        when {
            failed -> Icon(WIcons.Alert, null, tint = Destructive, modifier = Modifier.size(ikona))
            waiting -> Text("⏳", fontSize = if (big) 14.sp else 12.sp)
            primary -> Box(Modifier.size(if (big) 8.dp else 7.dp).clip(CircleShape).background(Amber))
            else -> Icon(WIcons.Pin, null, tint = Ink, modifier = Modifier.size(ikona))
        }
        Text(
            code,
            fontFamily = BarlowCond,
            fontWeight = if (big) FontWeight.ExtraBold else FontWeight.Bold,
            fontSize = if (big) 19.sp else 15.sp,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            color = ink,
            // schodząca lokalizacja jeszcze JEST w Subiekcie — przekreślenie mówi
            // „to zaraz zniknie", a nie „tego już nie ma"
            textDecoration = if (state == LocState.REMOVING) TextDecoration.LineThrough else null,
        )
    }
}

/* `formatQty` mieszka w :core (core/text/Qty.kt) — teksty karty towaru
   formatują ilości same, a testowalne są wyłącznie tam. */

/**
 * Pastylka adresu półki — ten sam napis przy dostawie i przy koszu zwrotowym.
 *
 * Mieszkała w `DeliveryLinesScreen` do 0.77.0, kiedy kosz dostał pełne
 * rozkładanie. Dwie kopie tego samego adresu rozjechałyby się przy pierwszej
 * poprawce, a ręce magazyniera czytają go tak samo na obu ekranach.
 *
 * Brak adresu jest TREŚCIĄ, nie pustką: półkę wybiera wtedy człowiek, więc
 * „BRAK" świeci bursztynem zamiast milczeć. W wierszu przygaszonym (pozycja
 * zrobiona) ta zachęta jest już nieaktualna i pastylka gaśnie.
 */
@Composable
fun LokPastylka(code: String?, przygaszona: Boolean) {
    val brak = code == null
    val wyroznij = brak && !przygaszona
    Text(
        code ?: "BRAK",
        fontFamily = BarlowCond,
        fontWeight = FontWeight.ExtraBold,
        fontSize = if (przygaszona) 12.sp else 15.sp,
        color = when {
            przygaszona -> InkMute
            brak -> AmberInk
            else -> Ink
        },
        modifier = Modifier
            .clip(RoundedCornerShape(50))
            .border(1.5.dp, if (wyroznij) AmberLine else CardBorder, RoundedCornerShape(50))
            .background(if (wyroznij) AmberBg else CardWhite)
            .padding(horizontal = 10.dp, vertical = 4.dp),
    )
}
