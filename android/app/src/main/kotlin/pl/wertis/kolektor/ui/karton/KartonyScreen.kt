package pl.wertis.kolektor.ui.karton

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import pl.wertis.kolektor.AppGraph
import pl.wertis.kolektor.core.karton.podpisKartonu
import pl.wertis.kolektor.core.net.KoszRow
import pl.wertis.kolektor.net.apiCall
import pl.wertis.kolektor.ui.components.LoadingRow
import pl.wertis.kolektor.ui.components.OutlineButton
import pl.wertis.kolektor.ui.components.PrimaryButton
import pl.wertis.kolektor.ui.components.WIcons
import pl.wertis.kolektor.ui.theme.AmberBg
import pl.wertis.kolektor.ui.theme.AmberInk
import pl.wertis.kolektor.ui.theme.BarlowCond
import pl.wertis.kolektor.ui.theme.Ink
import pl.wertis.kolektor.ui.theme.InkMute
import pl.wertis.kolektor.ui.theme.InkSoft
import pl.wertis.kolektor.ui.theme.cardSurface

/* ── Zakładka KARTON: lista pudeł ────────────────────────────────────────────
   Pakujący odkładają do jednego pudła towary źle zebrane pod zamówienia.
   Nikt tego nie zamawiał, nikt nie wystawił na to dokumentu i nic nie zeszło
   ze stanu — a jednak ktoś musi to rozłożyć na półki.

   Ekran zaczyna się od PRZYCISKU, nie od listy, bo tak zaczyna się ta praca:
   człowiek podchodzi z pudłem, którego jeszcze nie ma w aplikacji. Lista niżej
   jest dla tych, którzy wracają do zaczętego pudła — a wracają często, bo
   kartonów bywa kilka naraz (decyzja właściciela).                           */

@Composable
fun KartonyScreen(graph: AppGraph) {
    val scope = rememberCoroutineScope()
    var reload by remember { mutableStateOf(0) }
    var zakladanie by remember { mutableStateOf(false) }

    val kartony by produceState<List<KoszRow>?>(null, reload) {
        value = try {
            apiCall { graph.api.kartony() }.kartony
        } catch (_: Exception) {
            value ?: emptyList()
        }
    }

    fun nowy() {
        if (zakladanie) return // podwójne stuknięcie zakładałoby dwa puste pudła
        zakladanie = true
        scope.launch {
            try {
                val r = apiCall { graph.api.kartonNowy() }
                graph.feedback.beep(true)
                graph.nav.openKarton(r.kosz.id)
            } catch (e: Exception) {
                graph.effects.toast(e.message ?: "Nie udało się założyć kartonu")
            } finally {
                zakladanie = false
            }
        }
    }

    val lista = kartony
    if (lista == null) {
        LoadingRow("Wczytywanie kartonów…")
        return
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        PrimaryButton(
            "NOWY KARTON",
            tall = true,
            enabled = !zakladanie,
            leadingIcon = WIcons.Karton,
            modifier = Modifier.fillMaxWidth(),
        ) { nowy() }

        if (lista.isEmpty()) {
            Text(
                "Nie ma otwartych kartonów. Podchodzisz z pudłem — zakładasz nowy " +
                    "i skanujesz to, co w nim leży.",
                fontSize = 13.sp,
                color = InkMute,
            )
        } else {
            Text(
                "KARTONY W ROBOCIE",
                fontSize = 11.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = 1.2.sp,
                color = InkSoft,
            )
            /* Kolejność przychodzi z serwera: otwarte przed zatwierdzonymi,
               a wewnątrz grupy od najnowszego. Kolektor jej nie przestawia —
               jedno miejsce na tę regułę, tak samo jak przy koszach. */
            lista.forEach { k -> KartonRowView(k) { graph.nav.openKarton(k.id) } }
        }

        OutlineButton("ODŚWIEŻ LISTĘ") { reload++ }
    }
}

@Composable
private fun KartonRowView(k: KoszRow, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .cardSurface()
            .heightIn(min = 56.dp)
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Box(
            modifier = Modifier
                .size(40.dp)
                .clip(RoundedCornerShape(10.dp))
                .background(AmberBg),
            contentAlignment = Alignment.Center,
        ) {
            Icon(WIcons.Karton, contentDescription = null, tint = AmberInk, modifier = Modifier.size(22.dp))
        }
        Column(Modifier.weight(1f)) {
            Text(
                "KARTON ${k.kod}",
                fontFamily = BarlowCond,
                fontWeight = FontWeight.Bold,
                fontSize = 17.sp,
                color = Ink,
            )
            Text(
                podpisKartonu(k.status, k.pozycji, k.odlozonych),
                fontSize = 12.sp,
                color = InkMute,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}
