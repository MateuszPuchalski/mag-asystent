package pl.wertis.kolektor.ui.scanloc

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import pl.wertis.kolektor.AppGraph
import pl.wertis.kolektor.core.loc.isKnownLoc
import pl.wertis.kolektor.core.loc.normalizeLoc
import pl.wertis.kolektor.core.loc.validateLoc
import pl.wertis.kolektor.core.nav.Screen
import pl.wertis.kolektor.core.net.LocAction
import pl.wertis.kolektor.core.net.LocationsInfo
import pl.wertis.kolektor.core.net.SetLocationBody
import pl.wertis.kolektor.core.offline.PendingOp
import pl.wertis.kolektor.core.scan.ScanKind
import pl.wertis.kolektor.data.Poll
import pl.wertis.kolektor.data.pollFlow
import pl.wertis.kolektor.net.apiCall
import pl.wertis.kolektor.scan.ScanHandlerEffect
import pl.wertis.kolektor.ui.chrome.UndoInfo
import pl.wertis.kolektor.ui.components.LoadingRow
import pl.wertis.kolektor.ui.components.PrimaryButton
import pl.wertis.kolektor.ui.components.WertisTextField
import pl.wertis.kolektor.ui.product.LocChoice
import pl.wertis.kolektor.ui.product.LocChoiceSheet
import pl.wertis.kolektor.ui.theme.Amber
import pl.wertis.kolektor.ui.theme.AmberBgSoft
import pl.wertis.kolektor.ui.theme.AmberDark
import pl.wertis.kolektor.ui.theme.BarlowCond
import pl.wertis.kolektor.ui.theme.BorderCol
import pl.wertis.kolektor.ui.theme.CardWhite
import pl.wertis.kolektor.ui.theme.Ink
import pl.wertis.kolektor.ui.theme.InkMute
import pl.wertis.kolektor.ui.theme.InkSoft

/* ── Zmiana lokalizacji: skan towaru → skan etykiety regału ─────────────────
   Port web/src/screens/ScanLoc.tsx. Auto-zapis (bez tapa) + pasek COFNIJ;
   przy >1 lokalizacjach arkusz zastąp/dodaj/zastąp jedną. EAN przechodzi
   do fallbacku (karta innego towaru).                                        */

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ScanLocScreen(graph: AppGraph) {
    val id = graph.nav.curId ?: return
    val scope = rememberCoroutineScope()

    val poll by remember(id) { pollFlow(2000) { apiCall { graph.api.product(id) } } }
        .collectAsState(initial = Poll())
    val locInfo by produceState<LocationsInfo?>(null) { value = graph.locationsRepo.get() }

    var manualOpen by remember { mutableStateOf(false) }
    var manual by remember { mutableStateOf("") }
    var pending by remember { mutableStateOf<String?>(null) }
    var saving by remember { mutableStateOf(false) }

    val p = poll.data

    /** Auto-zapis + pasek COFNIJ, powrót na kartę. */
    fun save(choice: LocChoice, successMsg: String) {
        if (saving) return
        saving = true
        scope.launch {
            try {
                val warn = if (!isKnownLoc(choice.value, locInfo)) "Lokalizacja spoza wykazu — sprawdź etykietę" else null
                val res = graph.offlineQueue.runOrBuffer(
                    kind = PendingOp.OpKind.SET_LOCATION,
                    user = graph.users.currentUser,
                    productId = id,
                    setLocation = SetLocationBody(choice.action, value = choice.value, replaced = choice.replaced),
                )
                graph.queueRepo.refreshNow()
                graph.feedback.beep(true)
                pending = null
                graph.effects.showUndo(
                    UndoInfo(
                        msg = if (res.offline) "Zapisano lokalnie · ${choice.value}" else "$successMsg · ${choice.value}",
                        queueId = res.queueId,
                        bufferId = res.bufferId,
                        warn = warn,
                    )
                )
                graph.nav.go(Screen.PRODUCT)
            } catch (e: Exception) {
                graph.effects.toast(e.message ?: "Błąd zapisu")
            } finally {
                saving = false
            }
        }
    }

    fun handleCode(raw: String) {
        val card = p ?: return
        val code = normalizeLoc(raw)
        val err = validateLoc(code, locInfo)
        if (err != null) {
            graph.effects.toast(err)
            graph.feedback.beep(false)
            return
        }
        if (card.locs.size > 1) {
            pending = code // realna decyzja — arkusz zostaje
            return
        }
        save(LocChoice(LocAction.REPLACE, code), "Lokalizacja zapisana")
    }

    ScanHandlerEffect { scan ->
        if (scan.kind == ScanKind.EAN) return@ScanHandlerEffect false // EAN → fallback
        handleCode(scan.code)
        true
    }

    if (p == null) {
        LoadingRow()
        return
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        // Tożsamość towaru — magazynier musi wiedzieć CO przenosi
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(10.dp))
                .border(1.dp, BorderCol, RoundedCornerShape(10.dp))
                .background(CardWhite)
                .padding(horizontal = 12.dp, vertical = 10.dp),
        ) {
            Text(p.name, fontWeight = FontWeight.Bold, fontSize = 14.sp, color = Ink)
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.padding(top = 3.dp)) {
                Text(p.sym, fontFamily = BarlowCond, fontWeight = FontWeight.Bold, fontSize = 15.sp, color = Ink)
                Text("EAN ${p.ean.ifEmpty { "—" }}", fontSize = 12.sp, color = InkSoft)
                Text(p.unit, fontSize = 12.sp, color = InkSoft)
            }
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
                modifier = Modifier.padding(top = 6.dp),
            ) {
                Text("TERAZ:", fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.sp, color = InkMute, modifier = Modifier.align(Alignment.CenterVertically))
                if (p.locs.isEmpty()) {
                    Text("brak lokalizacji", fontSize = 13.sp, color = InkMute)
                } else {
                    p.locs.forEachIndexed { i, c ->
                        Text(
                            c,
                            fontFamily = BarlowCond,
                            fontWeight = FontWeight.Bold,
                            fontSize = 13.sp,
                            color = if (i == 0) Color.White else Ink,
                            modifier = Modifier
                                .clip(RoundedCornerShape(50))
                                .border(1.5.dp, Ink, RoundedCornerShape(50))
                                .background(if (i == 0) Ink else CardWhite)
                                .padding(horizontal = 10.dp, vertical = 2.dp),
                        )
                    }
                }
            }
        }

        Text(
            "Podejdź do miejsca docelowego i zeskanuj jego etykietę — zapis nastąpi od razu (z opcją COFNIJ).",
            fontSize = 13.sp,
            color = InkSoft,
        )

        // strefa „czekam na skan”
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(14.dp))
                .border(2.dp, Amber, RoundedCornerShape(14.dp))
                .background(AmberBgSoft)
                .padding(vertical = 24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text("▮▮▯▮▯▮▮", fontSize = 22.sp, color = Ink)
            Text(
                "ZESKANUJ ETYKIETĘ LOKALIZACJI",
                fontFamily = BarlowCond,
                fontWeight = FontWeight.Bold,
                fontSize = 16.sp,
                letterSpacing = 1.sp,
                color = Ink,
            )
            Text("czekam na skan…", fontSize = 11.sp, color = InkMute)
        }

        if (locInfo?.allowManual != false) {
            if (!manualOpen) {
                Text(
                    "Wpisz lokalizację ręcznie…",
                    fontSize = 13.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = AmberDark,
                    textAlign = TextAlign.Center,
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { manualOpen = true }
                        .padding(6.dp),
                )
            } else {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        WertisTextField(
                            value = manual,
                            onValueChange = { manual = it.uppercase() },
                            placeholder = "np. E08-03-01",
                            modifier = Modifier.weight(1f),
                            onDone = { handleCode(manual) },
                        )
                        PrimaryButton("OK") { handleCode(manual) }
                    }
                    Text("Bez spacji · ręczne wpisywanie = ryzyko literówek", fontSize = 11.sp, color = InkMute)
                }
            }
        }
    }

    LocChoiceSheet(product = p, code = pending, onClose = { pending = null }, onPick = ::save)
}
