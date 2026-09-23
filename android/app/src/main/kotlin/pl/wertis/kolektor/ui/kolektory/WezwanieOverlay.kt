package pl.wertis.kolektor.ui.kolektory

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import pl.wertis.kolektor.AppGraph
import pl.wertis.kolektor.ui.theme.Amber
import pl.wertis.kolektor.ui.theme.BarlowCond
import pl.wertis.kolektor.ui.theme.CardWhite
import pl.wertis.kolektor.ui.theme.Ink

/* ── Nakładka dzwoniącego kolektora ─────────────────────────────────────────
   CAŁY EKRAN JEST PRZYCISKIEM ZNALAZŁEM. Kolektor podnosi ktoś, kto go
   szukał, zwykle z drugą ręką zajętą, a syrena gra mu przy uchu. Szukanie
   przycisku na ekranie w tej chwili to najgorszy możliwy cel dotyku
   (dekalog, punkty 2 i 4): każde dotknięcie ma uciszyć, bez celowania.

   Nakładka stoi NAD wszystkim, także nad arkuszami. Pod spodem mógł zostać
   otwarty ekran pracy i pierwsze dotknięcie nie może trafić w niego —
   dlatego to samo dotknięcie jest połknięte przez nakładkę, nie przepuszczone. */

@Composable
fun WezwanieOverlay(graph: AppGraph) {
    val w by graph.wezwanie.wezwanie.collectAsStateWithLifecycle()
    val wezwanie = w ?: return
    val bezEfektu = remember { MutableInteractionSource() }
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Ink)
            .clickable(interactionSource = bezEfektu, indication = null) { graph.wezwanie.znalazlem() },
        contentAlignment = Alignment.Center,
    ) {
        Column(
            modifier = Modifier.padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text(
                "KTOŚ SZUKA TEGO KOLEKTORA",
                color = CardWhite,
                fontFamily = BarlowCond,
                fontWeight = FontWeight.Bold,
                fontSize = 20.sp,
                textAlign = TextAlign.Center,
            )
            Text(
                "wezwał(a): ${wezwanie.przez}",
                color = CardWhite,
                fontSize = 16.sp,
                textAlign = TextAlign.Center,
            )
            Text(
                "ZNALAZŁEM",
                color = Amber,
                fontFamily = BarlowCond,
                fontWeight = FontWeight.ExtraBold,
                fontSize = 44.sp,
                textAlign = TextAlign.Center,
            )
            Text(
                "dotknij w dowolnym miejscu",
                color = CardWhite,
                fontSize = 14.sp,
                textAlign = TextAlign.Center,
            )
        }
    }
}
