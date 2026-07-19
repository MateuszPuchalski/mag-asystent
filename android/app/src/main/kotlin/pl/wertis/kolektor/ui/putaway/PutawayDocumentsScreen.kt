package pl.wertis.kolektor.ui.putaway

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
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
import pl.wertis.kolektor.core.net.CreateSessionBody
import pl.wertis.kolektor.core.net.PutawayDocument
import pl.wertis.kolektor.core.net.PutawayZone
import pl.wertis.kolektor.net.apiCall
import pl.wertis.kolektor.ui.components.LoadingRow
import pl.wertis.kolektor.ui.components.OutlineButton
import pl.wertis.kolektor.ui.theme.AmberBg
import pl.wertis.kolektor.ui.theme.AmberInk
import pl.wertis.kolektor.ui.theme.BarlowCond
import pl.wertis.kolektor.ui.theme.BorderCol
import pl.wertis.kolektor.ui.theme.CardWhite
import pl.wertis.kolektor.ui.theme.Ink
import pl.wertis.kolektor.ui.theme.InkMute
import pl.wertis.kolektor.ui.theme.InkSoft
import pl.wertis.kolektor.ui.theme.Secondary
import pl.wertis.kolektor.ui.theme.Success

/* ── Dokumenty do rozłożenia — port putaway/Documents.tsx ───────────────────
   Zwroty od klientów + dostawy FZ/PZ (14 dni) z postępem sesji; tryb
   zapasowy „ROZKŁADAJ CAŁE MGP” (bez dokumentu).                             */

@Composable
fun PutawayDocumentsScreen(graph: AppGraph) {
    val scope = rememberCoroutineScope()
    var reload by remember { mutableStateOf(0) }
    val docs by produceState<List<PutawayDocument>?>(null, reload) {
        value = try {
            apiCall { graph.api.putawayDocuments() }.documents
        } catch (_: Exception) {
            emptyList()
        }
    }

    fun open(docId: Long?, mode: String? = null) {
        scope.launch {
            try {
                val r = apiCall { graph.api.createSession(CreateSessionBody(docId = docId, mode = mode)) }
                reload++
                graph.nav.openSession(r.sessionId)
            } catch (e: Exception) {
                graph.effects.toast(e.message ?: "Nie udało się otworzyć sesji")
            }
        }
    }

    if (docs == null) {
        LoadingRow("Wczytywanie dokumentów…")
        return
    }

    val deliveries = docs!!.filter { it.zone != PutawayZone.ZWROTY }
    val returns = docs!!.filter { it.zone == PutawayZone.ZWROTY }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        if (returns.isNotEmpty()) {
            Text(
                "ZWROTY OD KLIENTÓW · KARTONY DO ROZŁOŻENIA",
                fontSize = 11.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = 1.2.sp,
                color = AmberInk,
            )
            returns.forEach { d -> DocRow(d) { open(d.docId) } }
        }

        Text(
            "DOSTAWY FZ/PZ NA MGP · OSTATNIE 14 DNI",
            fontSize = 11.sp,
            fontWeight = FontWeight.Bold,
            letterSpacing = 1.2.sp,
            color = InkMute,
        )
        if (deliveries.isEmpty()) {
            Text(
                "Brak dokumentów do rozłożenia",
                color = InkMute,
                fontSize = 13.sp,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth().padding(vertical = 10.dp),
            )
        }
        deliveries.forEach { d -> DocRow(d) { open(d.docId) } }

        OutlineButton("⧉ ROZKŁADAJ CAŁE MGP", tall = true, modifier = Modifier.fillMaxWidth().padding(top = 4.dp)) {
            open(null, mode = "all_mgp")
        }
        Text(
            "Tryb zapasowy — wszystkie towary ze stanem na strefie przyjęć, bez dokumentu.",
            fontSize = 11.sp,
            color = InkMute,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

@Composable
private fun DocRow(d: PutawayDocument, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .border(1.dp, BorderCol, RoundedCornerShape(10.dp))
            .background(CardWhite)
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 11.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Box(
            modifier = Modifier
                .size(40.dp)
                .clip(RoundedCornerShape(10.dp))
                .background(Secondary),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                if (d.zone == PutawayZone.ZWROTY) "↩" else "📦",
                fontSize = 18.sp,
                color = if (d.zone == PutawayZone.ZWROTY) AmberInk else Ink,
            )
        }
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(
                    d.nrPelny,
                    fontFamily = BarlowCond,
                    fontWeight = FontWeight.Bold,
                    fontSize = 15.sp,
                    color = Ink,
                )
                d.session?.let { s ->
                    val done = s.progressPct >= 100
                    Text(
                        "${s.progressPct.toInt()}%",
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold,
                        color = if (done) Success else AmberInk,
                        modifier = Modifier
                            .clip(RoundedCornerShape(6.dp))
                            .background(if (done) Success.copy(alpha = 0.15f) else AmberBg)
                            .padding(horizontal = 6.dp, vertical = 1.dp),
                    )
                }
            }
            Text(d.dostawca, fontSize = 12.sp, color = InkSoft, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text("${d.dataWyst} · ${d.positions} poz.", fontSize = 11.sp, color = InkMute)
        }
        Text("›", fontSize = 20.sp, color = InkMute)
    }
}
