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
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
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
import pl.wertis.kolektor.core.session.userInitials
import pl.wertis.kolektor.ui.components.WIcons
import pl.wertis.kolektor.ui.theme.Amber
import pl.wertis.kolektor.ui.theme.AmberBg
import pl.wertis.kolektor.ui.theme.AmberBgSoft
import pl.wertis.kolektor.ui.theme.AmberInk
import pl.wertis.kolektor.ui.theme.InkMute
import pl.wertis.kolektor.ui.theme.BarlowCond
import pl.wertis.kolektor.ui.theme.CardWhite
import pl.wertis.kolektor.ui.theme.Destructive
import pl.wertis.kolektor.ui.theme.Ink
import pl.wertis.kolektor.ui.theme.InkSoft
import pl.wertis.kolektor.ui.theme.PillRest
import pl.wertis.kolektor.ui.theme.ShadowInk
import pl.wertis.kolektor.ui.theme.Success

/* ── Pasek górny: logo · tytuł · awatar · pastylka Sfery ──────────────────────
   WSTECZ STĄD ZNIKŁO. Siedziało w lewym górnym rogu, czyli w miejscu, którego
   kciuk nie dosięga na żadnym sposobie trzymania kolektora — a to najczęściej
   naciskany przycisk w całej aplikacji. Przeniesione na dolny pasek (`TabBar`),
   po prawej, bo tak trzyma się sprzęt na tej hali.

   Górny pasek zostaje przy rzeczach, po które sięga się rzadko i świadomie:
   ustawienia i kolejka Sfery.                                                 */

@Composable
fun TopBar(
    screen: Screen,
    user: String,
    summary: QueueSummary?,
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
        Text(
            "WERTIS",
            color = Amber,
            fontFamily = BarlowCond,
            fontWeight = FontWeight.ExtraBold,
            fontSize = 18.sp,
            modifier = Modifier.padding(horizontal = 10.dp),
        )
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

/* ── Dolny pasek: SKAN · DOSTAWY · WSTECZ ────────────────────────────────────
   WSTECZ stoi PO PRAWEJ, bo kolektor trzyma się w prawej dłoni i tam ląduje
   kciuk. Wcześniej był w lewym górnym rogu — najdalszym punkcie ekranu od
   kciuka przy dowolnym chwycie.

   MIEJSCE NA WSTECZ JEST ZAREZERWOWANE ZAWSZE, także gdy nie ma dokąd wracać.
   Inaczej SKAN i DOSTAWY przeskakiwałyby w bok przy każdym wejściu
   w podekran, a te dwa przyciski trafia się z pamięci, nie wzrokiem —
   przesuwający się cel to wciśnięcie sąsiada.                                 */

/** Szerokość slotu WSTECZ — stała, bo rezerwacja miejsca jest tu całym sensem. */
private val BackSlot = 76.dp

@Composable
fun TabBar(screen: Screen, hasBack: Boolean, onHome: () -> Unit, onPutaway: () -> Unit, onBack: () -> Unit) {
    val putawayActive = screen == Screen.DELIVERY_DOCS || screen == Screen.DELIVERY_LINES
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
        TabItem("DOSTAWY", WIcons.Box, putawayActive, Modifier.weight(1f), onPutaway)
        if (hasBack) {
            BackTab(Modifier.width(BackSlot), onBack)
        } else {
            // pusty slot tej samej szerokości — patrz komentarz wyżej
            Box(Modifier.width(BackSlot))
        }
    }
}

/**
 * WSTECZ — wizualnie odrębny od zakładek, bo robi co innego.
 *
 * SKAN i DOSTAWY PRZEŁĄCZAJĄ tryb pracy i mają stan „aktywny"; WSTECZ
 * cofa o krok i stanu nie ma. Gdyby wyglądał jak trzecia zakładka, człowiek
 * szukałby w nim trzeciego trybu.
 */
@Composable
private fun BackTab(modifier: Modifier, onClick: () -> Unit) {
    Column(
        modifier = modifier
            .fillMaxHeight()
            .clickable(onClick = onClick)
            .padding(vertical = 6.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Box(
            modifier = Modifier
                .clip(RoundedCornerShape(50))
                .background(Ink)
                .padding(horizontal = 14.dp, vertical = 4.dp),
            contentAlignment = Alignment.Center,
        ) {
            Icon(WIcons.Back, contentDescription = "Wstecz", tint = Amber, modifier = Modifier.size(22.dp))
        }
        Text(
            "WSTECZ",
            fontFamily = BarlowCond,
            fontWeight = FontWeight.SemiBold,
            fontSize = 11.5.sp,
            letterSpacing = 0.4.sp,
            color = InkSoft,
            modifier = Modifier.padding(top = 3.dp),
        )
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

/* ── Pasek wersji ───────────────────────────────────────────────────────────
   POD paskiem zakładek, nie w nim. Dolne 62 dp to teren kciuka: SKAN,
   DOSTAWY i WSTECZ zeszły tam właśnie po to, żeby dało się je trafić bez
   patrzenia. Napis wciśnięty między nie odebrałby im pola dotyku, a przy
   okazji przesunął cele — czyli zepsułby dokładnie to, co tamta zmiana
   naprawiała.

   Wersja serwera stoi obok wersji aplikacji, bo pytanie po każdej
   aktualizacji brzmi „czy kolektor ma już nowy build". `git pull` przestawia
   serwer od razu, APK czeka na rozesłanie przez MDM — i to rozjazd, nie
   awaria, więc ma być widoczny, a nie alarmujący.                           */

@Composable
fun WersjaBar(wersjaAplikacji: String, wersjaSerwera: String?) {
    val rozjazd = wersjaSerwera != null && wersjaSerwera.isNotBlank() && wersjaSerwera != wersjaAplikacji
    val opis = when {
        wersjaSerwera.isNullOrBlank() -> "WERTIS $wersjaAplikacji · serwer: brak połączenia"
        rozjazd -> "WERTIS $wersjaAplikacji · serwer $wersjaSerwera — wersje różne"
        else -> "WERTIS $wersjaAplikacji"
    }
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .background(if (rozjazd) AmberBgSoft else CardWhite)
            .padding(vertical = 3.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            opis,
            fontSize = 9.5.sp,
            letterSpacing = 0.4.sp,
            color = if (rozjazd) AmberInk else InkMute,
        )
    }
}
