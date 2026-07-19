package pl.wertis.kolektor.ui.chrome

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import pl.wertis.kolektor.core.nav.SCREEN_TITLES
import pl.wertis.kolektor.core.nav.Screen
import pl.wertis.kolektor.core.net.QueueSummary
import pl.wertis.kolektor.data.userInitials
import pl.wertis.kolektor.ui.theme.Amber
import pl.wertis.kolektor.ui.theme.AmberBg
import pl.wertis.kolektor.ui.theme.AmberInk
import pl.wertis.kolektor.ui.theme.BarlowCond
import pl.wertis.kolektor.ui.theme.BorderCol
import pl.wertis.kolektor.ui.theme.CardWhite
import pl.wertis.kolektor.ui.theme.Destructive
import pl.wertis.kolektor.ui.theme.Ink
import pl.wertis.kolektor.ui.theme.InkSoft
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
            .height(48.dp)
            .padding(horizontal = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (hasBack) {
            Text(
                "‹",
                color = Amber,
                fontSize = 28.sp,
                fontWeight = FontWeight.Bold,
                modifier = Modifier
                    .clip(CircleShape)
                    .clickable(onClick = onBack)
                    .padding(horizontal = 12.dp),
            )
        } else {
            Text(
                "WERTIS",
                color = Amber,
                fontFamily = BarlowCond,
                fontWeight = FontWeight.ExtraBold,
                fontSize = 18.sp,
                modifier = Modifier.padding(horizontal = 8.dp),
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
                .size(32.dp)
                .clip(CircleShape)
                .background(Amber)
                .clickable(onClick = onOpenSettings),
            contentAlignment = Alignment.Center,
        ) {
            Text(userInitials(user), color = Ink, fontWeight = FontWeight.Bold, fontSize = 13.sp)
        }
        Box(Modifier.size(8.dp))
        SferaPill(summary, onClick = onOpenQueue)
    }
}

/* ── Pastylka statusu Sfery: czerwona (błędy) > amber (kolejka) > zielona ── */

@Composable
fun SferaPill(summary: QueueSummary?, onClick: () -> Unit) {
    val errors = summary?.error ?: 0
    val pending = summary?.pending ?: 0

    val (bg: Color, fg: Color, label: String) = when {
        errors > 0 -> Triple(Destructive, CardWhite, if (errors == 1) "1 błąd" else "$errors błędy")
        pending > 0 -> Triple(Amber, Ink, "$pending w kolejce")
        else -> Triple(Ink, CardWhite, "Sfera")
    }
    val pulse = rememberInfiniteTransition(label = "pill")
    val alpha by pulse.animateFloat(
        initialValue = 1f,
        targetValue = if (errors > 0) 0.55f else 1f,
        animationSpec = infiniteRepeatable(tween(700, easing = LinearEasing), RepeatMode.Reverse),
        label = "pillAlpha",
    )

    Row(
        modifier = Modifier
            .alpha(alpha)
            .clip(RoundedCornerShape(50))
            .background(bg)
            .clickable(onClick = onClick)
            .padding(horizontal = 10.dp, vertical = 5.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        if (errors == 0 && pending == 0) {
            Box(Modifier.size(7.dp).clip(CircleShape).background(Success))
        }
        Text(label, color = fg, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
    }
}

/* ── Dolny pasek: SKAN · ROZKŁADANIE ──────────────────────────────────────── */

@Composable
fun TabBar(screen: Screen, onHome: () -> Unit, onPutaway: () -> Unit) {
    val putawayActive = screen == Screen.PUTAWAY_DOCS || screen == Screen.PUTAWAY_SESSION
    val homeActive = !putawayActive && screen != Screen.QUEUE

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(CardWhite)
            .height(54.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        TabItem("SKAN", homeActive, Modifier.weight(1f), onHome)
        TabItem("ROZKŁADANIE", putawayActive, Modifier.weight(1f), onPutaway)
    }
}

@Composable
private fun TabItem(label: String, active: Boolean, modifier: Modifier, onClick: () -> Unit) {
    Box(
        modifier = modifier
            .clickable(onClick = onClick)
            .padding(vertical = 8.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            label,
            fontFamily = BarlowCond,
            fontWeight = if (active) FontWeight.ExtraBold else FontWeight.SemiBold,
            fontSize = 15.sp,
            color = if (active) AmberInk else InkSoft,
            modifier = if (active) {
                Modifier
                    .clip(RoundedCornerShape(8.dp))
                    .background(AmberBg)
                    .padding(horizontal = 14.dp, vertical = 6.dp)
            } else {
                Modifier.padding(horizontal = 14.dp, vertical = 6.dp)
            },
        )
    }
}

/* separator górnej/dolnej krawędzi */
@Composable
fun HairLine() {
    Box(Modifier.fillMaxWidth().height(1.dp).background(BorderCol))
}
