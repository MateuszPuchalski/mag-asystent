package pl.wertis.kolektor.ui.chrome

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import pl.wertis.kolektor.core.nav.SCREEN_TITLES
import pl.wertis.kolektor.core.nav.Screen
import pl.wertis.kolektor.core.net.QueueSummary
import pl.wertis.kolektor.data.userInitials
import pl.wertis.kolektor.ui.components.WIcons
import pl.wertis.kolektor.ui.theme.Amber
import pl.wertis.kolektor.ui.theme.AmberBg
import pl.wertis.kolektor.ui.theme.AmberInk
import pl.wertis.kolektor.ui.theme.BarlowCond
import pl.wertis.kolektor.ui.theme.BorderCol
import pl.wertis.kolektor.ui.theme.CardWhite
import pl.wertis.kolektor.ui.theme.Destructive
import pl.wertis.kolektor.ui.theme.Ink
import pl.wertis.kolektor.ui.theme.InkSoft
import pl.wertis.kolektor.ui.theme.PillRest
import pl.wertis.kolektor.ui.theme.ShadowInk
import pl.wertis.kolektor.ui.theme.Success

/* ── Pasek górny: wstecz/logo · tytuł · awatar · pastylka Sfery ───────────── */

@Composable
fun TopBar(
    screen: Screen,
    hasBack: Boolean,
    user: String,
    summary: QueueSummary?,
    onBack: () -> Unit,
    onOpenQueue: () -> Unit,
    onOpenSettings: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(Ink)
            .height(52.dp)
            .padding(horizontal = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (hasBack) {
            Box(
                modifier = Modifier
                    .size(44.dp)
                    .clip(CircleShape)
                    .clickable(onClick = onBack),
                contentAlignment = Alignment.Center,
            ) {
                Icon(WIcons.Back, contentDescription = "Wstecz", tint = Amber, modifier = Modifier.size(24.dp))
            }
        } else {
            Text(
                "WERTIS",
                color = Amber,
                fontFamily = BarlowCond,
                fontWeight = FontWeight.ExtraBold,
                fontSize = 18.sp,
                modifier = Modifier.padding(horizontal = 10.dp),
            )
        }
        Text(
            SCREEN_TITLES[screen] ?: "",
            color = CardWhite,
            fontFamily = BarlowCond,
            fontWeight = FontWeight.SemiBold,
            fontSize = 16.sp,
            textAlign = TextAlign.Center,
            maxLines = 1,
            modifier = Modifier.weight(1f),
        )
        // awatar (inicjały) → ustawienia
        Box(
            modifier = Modifier
                .size(40.dp)
                .clip(CircleShape)
                .background(Amber)
                .clickable(onClick = onOpenSettings),
            contentAlignment = Alignment.Center,
        ) {
            Text(userInitials(user), color = Ink, fontWeight = FontWeight.Bold, fontSize = 15.sp)
        }
        Box(Modifier.size(8.dp))
        SferaPill(summary, onClick = onOpenQueue)
        Box(Modifier.size(2.dp))
    }
}

/* ── Pastylka statusu Sfery: czerwona (błędy) > amber (kolejka) > zielona ── */

@Composable
fun SferaPill(summary: QueueSummary?, onClick: () -> Unit) {
    val errors = summary?.error ?: 0
    val pending = summary?.pending ?: 0

    val bg: Color; val fg: Color; val label: String; val icon: ImageVector?
    when {
        errors > 0 -> { bg = Destructive; fg = CardWhite; label = if (errors == 1) "1 błąd" else "$errors błędy"; icon = WIcons.Alert }
        pending > 0 -> { bg = Amber; fg = Ink; label = "$pending w kolejce"; icon = WIcons.Clock }
        // spoczynek: uniesiona grafitowa powierzchnia z obrysem — nie grafit-na-grafit
        else -> { bg = PillRest; fg = CardWhite; label = "Sfera"; icon = null }
    }
    val resting = errors == 0 && pending == 0

    val pulse = rememberInfiniteTransition(label = "pill")
    val alpha by pulse.animateFloat(
        initialValue = 1f,
        targetValue = if (errors > 0) 0.55f else 1f,
        animationSpec = infiniteRepeatable(tween(700, easing = LinearEasing), RepeatMode.Reverse),
        label = "pillAlpha",
    )
    val shape = RoundedCornerShape(50)

    Row(
        modifier = Modifier
            .alpha(alpha)
            .shadow(3.dp, shape, clip = false, ambientColor = ShadowInk, spotColor = ShadowInk)
            .clip(shape)
            .background(bg)
            .then(if (resting) Modifier.border(1.dp, Color.White.copy(alpha = 0.18f), shape) else Modifier)
            .heightIn(min = 40.dp)
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        if (icon != null) {
            Icon(icon, contentDescription = null, tint = fg, modifier = Modifier.size(15.dp))
        } else {
            Box(
                Modifier
                    .size(8.dp)
                    .clip(CircleShape)
                    .background(Success)
                    .border(3.dp, Success.copy(alpha = 0.25f), CircleShape),
            )
        }
        Text(label, color = fg, fontSize = 12.5.sp, fontWeight = FontWeight.SemiBold)
    }
}

/* ── Dolny pasek: SKAN · ROZKŁADANIE (ikona + etykieta, aktywna w bursztynie) ── */

@Composable
fun TabBar(screen: Screen, onHome: () -> Unit, onPutaway: () -> Unit) {
    val putawayActive = screen == Screen.PUTAWAY_DOCS || screen == Screen.PUTAWAY_SESSION
    val homeActive = !putawayActive && screen != Screen.QUEUE

    Row(
        modifier = Modifier
            .shadow(8.dp, clip = false, ambientColor = ShadowInk, spotColor = ShadowInk)
            .fillMaxWidth()
            .background(CardWhite)
            .height(62.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        TabItem("SKAN", WIcons.Scan, homeActive, Modifier.weight(1f), onHome)
        TabItem("ROZKŁADANIE", WIcons.Box, putawayActive, Modifier.weight(1f), onPutaway)
    }
}

@Composable
private fun TabItem(label: String, icon: ImageVector, active: Boolean, modifier: Modifier, onClick: () -> Unit) {
    Column(
        modifier = modifier
            .clickable(onClick = onClick)
            .padding(vertical = 6.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        Icon(
            icon,
            contentDescription = label,
            tint = if (active) AmberInk else InkSoft,
            modifier = Modifier
                .then(
                    if (active) {
                        Modifier
                            .clip(RoundedCornerShape(50))
                            .background(AmberBg)
                            .padding(horizontal = 16.dp, vertical = 3.dp)
                    } else {
                        Modifier.padding(horizontal = 16.dp, vertical = 3.dp)
                    },
                )
                .size(23.dp),
        )
        Text(
            label,
            fontFamily = BarlowCond,
            fontWeight = if (active) FontWeight.ExtraBold else FontWeight.SemiBold,
            fontSize = 12.5.sp,
            letterSpacing = 0.4.sp,
            color = if (active) AmberInk else InkSoft,
        )
    }
}

/* separator górnej/dolnej krawędzi */
@Composable
fun HairLine() {
    Box(Modifier.fillMaxWidth().height(1.dp).background(BorderCol))
}
