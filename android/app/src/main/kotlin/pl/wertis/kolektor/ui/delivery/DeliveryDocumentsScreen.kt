package pl.wertis.kolektor.ui.delivery

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
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
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import pl.wertis.kolektor.AppGraph
import pl.wertis.kolektor.core.delivery.dokumentZamkniety
import pl.wertis.kolektor.core.net.DeliveryDocument
import pl.wertis.kolektor.core.net.DeliveryDocumentsResponse
import pl.wertis.kolektor.net.apiCall
import pl.wertis.kolektor.ui.components.LoadingRow
import pl.wertis.kolektor.ui.components.OutlineButton
import pl.wertis.kolektor.ui.components.WIcons
import pl.wertis.kolektor.ui.theme.Amber
import pl.wertis.kolektor.ui.theme.AmberBg
import pl.wertis.kolektor.ui.theme.AmberInk
import pl.wertis.kolektor.ui.theme.BarlowCond
import pl.wertis.kolektor.ui.theme.CardBorder
import pl.wertis.kolektor.ui.theme.Ink
import pl.wertis.kolektor.ui.theme.InkMute
import pl.wertis.kolektor.ui.theme.InkSoft
import pl.wertis.kolektor.ui.theme.Secondary
import pl.wertis.kolektor.ui.theme.Success
import pl.wertis.kolektor.ui.theme.cardSurface

/* ── Tryb A: wybór dokumentu (redesign §4.1) ────────────────────────────────
   Lista faktur zakupu z okna importu, malejąco po dacie, z paskiem postępu.
   Dokumenty w buforze SGT są normalnie dostępne do pracy (D1) — rozkładanie nie
   czeka na księgowość. Ukończone schodzą na dół i szarzeją, ale nie znikają.

   ZWROTY NIE SĄ TU LISTOWANE. Zakładka pokazuje wyłącznie to, czym towar wchodzi
   na magazyn u tego klienta — a to są same FZ (`DOK_TYPY_DOSTAW=1`). Zwroty mają
   inny rytm pracy (koszyk, nie paleta) i inny skutek (MM Zwroty→MAG), więc
   wracają jako osobne wejście, a nie jako sekcja tutaj.

   Serwerowa ścieżka koszyków ZOSTAJE nietknięta — to jest ukrycie wejścia,
   nie wycofanie funkcji.                                                     */

@Composable
fun DeliveryDocumentsScreen(graph: AppGraph) {
    val scope = rememberCoroutineScope()
    var reload by remember { mutableStateOf(0) }
    val odpowiedz by produceState<DeliveryDocumentsResponse?>(null, reload) {
        value = try {
            apiCall { graph.api.deliveryDocuments() }
        } catch (_: Exception) {
            DeliveryDocumentsResponse()
        }
    }

    fun open(d: DeliveryDocument) {
        scope.launch {
            try {
                val r = apiCall { graph.api.openDelivery(d.dokId) }
                graph.nav.openDelivery(r.deliveryId)
            } catch (e: Exception) {
                graph.effects.toast(e.message ?: "Nie udało się otworzyć dostawy")
            }
        }
    }

    val r = odpowiedz
    if (r == null) {
        LoadingRow("Wczytywanie dostaw…")
        return
    }

    // Ukończone na dół, reszta malejąco po dacie (serwer już sortuje po dacie).
    // „Ukończone" obejmuje faktury oznaczone jako sprawdzone w SUBIEKCIE —
    // rozkładanie jest sprawdzaniem faktury, więc taka dostawa nie ma czego
    // szukać w kolejce do rozłożenia, choćby jej tu nikt nie otwierał.
    //
    // Zwroty odfiltrowane TUTAJ, nie na serwerze: trasa i koszyki zostają
    // sprawne, znika tylko wejście z tej zakładki.
    val dostawy = r.documents
        .filter { !it.zwrot }
        .sortedBy { dokumentZamkniety(it.linesTotal, it.linesDone, it.flagaKey) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(
            "FAKTURY ZAKUPU · OSTATNIE ${r.dniWstecz} DNI",
            fontSize = 11.sp,
            fontWeight = FontWeight.Bold,
            letterSpacing = 1.2.sp,
            color = InkSoft,
        )
        if (dostawy.isEmpty()) {
            Text(
                "Brak dostaw do rozłożenia",
                color = InkMute,
                fontSize = 13.sp,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp),
            )
        }
        dostawy.forEach { d -> DocRow(d) { open(d) } }

        OutlineButton(
            "KONTENERY",
            modifier = Modifier.fillMaxWidth().padding(top = 6.dp),
        ) { graph.nav.go(pl.wertis.kolektor.core.nav.Screen.PUTAWAY_DOCS) }
        Text(
            "Kontener importowy (4× w roku) — sesja z wózkiem i MM MGP→MAG po każdej rundzie.",
            fontSize = 11.sp,
            color = InkMute,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

@Composable
private fun DocRow(d: DeliveryDocument, onClick: () -> Unit) {
    val complete = dokumentZamkniety(d.linesTotal, d.linesDone, d.flagaKey)
    val total = if (d.linesTotal > 0) d.linesTotal else d.positions
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
                .background(
                    when {
                        complete -> Success.copy(alpha = 0.15f)
                        // zwrot odróżnia się także po przewinięciu nagłówka sekcji
                        d.zwrot -> AmberBg
                        else -> Secondary
                    }
                ),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                if (complete) WIcons.Check else WIcons.Box,
                contentDescription = null,
                tint = when {
                    complete -> Success
                    d.zwrot -> AmberInk
                    else -> Ink
                },
                modifier = Modifier.size(20.dp),
            )
        }
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(
                    d.nrPelny,
                    fontFamily = BarlowCond,
                    fontWeight = FontWeight.Bold,
                    fontSize = 15.sp,
                    color = if (complete) InkMute else Ink,
                )
                if (d.wBuforze) {
                    // bufor nie blokuje pracy (D1) — informacja, nie ostrzeżenie
                    Text(
                        "bufor",
                        fontSize = 10.sp,
                        fontWeight = FontWeight.Bold,
                        color = AmberInk,
                        modifier = Modifier
                            .clip(RoundedCornerShape(6.dp))
                            .background(AmberBg)
                            .padding(horizontal = 6.dp, vertical = 1.dp),
                    )
                }
            }
            Text(d.dostawca, fontSize = 12.sp, color = InkSoft, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(
                "${d.dataWyst} · ${d.positions} poz.",
                fontSize = 11.sp,
                color = InkMute,
            )
            // stan sprawdzenia faktury — to samo, co biuro widzi w Subiekcie
            FlagBadge(d.flaga, d.flagaKey, Modifier.padding(top = 3.dp))
            if (d.linesTotal > 0) {
                ProgressBar(d.linesDone, d.linesTotal, complete)
            }
        }
        Column(horizontalAlignment = Alignment.End) {
            Text(
                if (d.linesTotal > 0) "${d.linesDone}/$total" else "$total poz.",
                fontFamily = BarlowCond,
                fontWeight = FontWeight.ExtraBold,
                fontSize = 15.sp,
                color = if (complete) Success else Ink,
            )
        }
    }
}

@Composable
private fun ProgressBar(done: Int, total: Int, complete: Boolean) {
    val frac = if (total > 0) done.toFloat() / total else 0f
    Box(
        Modifier
            .padding(top = 5.dp)
            .fillMaxWidth()
            .height(5.dp)
            .clip(RoundedCornerShape(50))
            .background(CardBorder),
    ) {
        Box(
            Modifier
                .fillMaxWidth(frac)
                .height(5.dp)
                .clip(RoundedCornerShape(50))
                .background(if (complete) Success else Amber),
        )
    }
}
