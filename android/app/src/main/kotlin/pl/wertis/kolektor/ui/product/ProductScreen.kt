package pl.wertis.kolektor.ui.product

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import pl.wertis.kolektor.AppGraph
import pl.wertis.kolektor.core.loc.isKnownLoc
import pl.wertis.kolektor.core.loc.validateLoc
import pl.wertis.kolektor.core.net.LocAction
import pl.wertis.kolektor.core.net.LocationsInfo
import pl.wertis.kolektor.core.net.MovementEntry
import pl.wertis.kolektor.core.net.ProductCard
import pl.wertis.kolektor.core.net.SetLocationBody
import pl.wertis.kolektor.core.net.StockView
import pl.wertis.kolektor.core.offline.PendingOp
import pl.wertis.kolektor.core.scan.ScanKind
import pl.wertis.kolektor.data.Poll
import pl.wertis.kolektor.data.pollFlow
import pl.wertis.kolektor.net.apiCall
import pl.wertis.kolektor.scan.ScanHandlerEffect
import pl.wertis.kolektor.ui.chrome.UndoInfo
import pl.wertis.kolektor.ui.components.LoadingRow
import pl.wertis.kolektor.ui.components.LocChip
import pl.wertis.kolektor.ui.components.OutlineButton
import pl.wertis.kolektor.ui.components.SectionLabel
import pl.wertis.kolektor.ui.components.WIcons
import pl.wertis.kolektor.ui.components.formatQty
import pl.wertis.kolektor.ui.product.LocChoice
import pl.wertis.kolektor.ui.product.LocChoiceSheet
import pl.wertis.kolektor.ui.theme.AmberBg
import pl.wertis.kolektor.ui.theme.AmberBgSoft
import pl.wertis.kolektor.ui.theme.AmberInk
import pl.wertis.kolektor.ui.theme.AmberLine
import pl.wertis.kolektor.ui.theme.BarlowCond
import pl.wertis.kolektor.ui.theme.BorderCol
import pl.wertis.kolektor.ui.theme.CardBorder
import pl.wertis.kolektor.ui.theme.CardWhite
import pl.wertis.kolektor.ui.theme.Ink
import pl.wertis.kolektor.ui.theme.InkMute
import pl.wertis.kolektor.ui.theme.InkSoft
import pl.wertis.kolektor.ui.theme.cardSurface

/* ── Karta towaru — port web/src/screens/Product.tsx ────────────────────────
   Intencja z kolejności skanów: na karcie skan etykiety regału = przenieś TEN
   towar TAM (przy >1 lokalizacjach — arkusz zastąp/dodaj/zastąp jedną);
   skan EAN przechodzi do fallbacku (karta kolejnego towaru).                 */

private const val LOC_LIMIT = 50

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ProductScreen(graph: AppGraph) {
    val id = graph.nav.curId ?: return
    val scope = rememberCoroutineScope()

    val poll by remember(id) {
        pollFlow(2000) { apiCall { graph.api.product(id) } }
    }.collectAsState(initial = Poll())
    val history by produceState<List<MovementEntry>>(emptyList(), id) {
        value = try {
            apiCall { graph.api.history(id) }.entries
        } catch (_: Exception) {
            emptyList()
        }
    }
    val locInfo by produceState<LocationsInfo?>(null) { value = graph.locationsRepo.get() }

    var chipMenu by remember(id) { mutableStateOf<String?>(null) }
    var pendingLoc by remember(id) { mutableStateOf<String?>(null) } // skan przy wielu lokalizacjach
    var saving by remember { mutableStateOf(false) }

    val p = poll.data

    /** Zapis relokacji ze skanu + pasek COFNIJ. */
    fun saveLoc(choice: LocChoice, successMsg: String) {
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
                pendingLoc = null
                graph.effects.showUndo(
                    UndoInfo(
                        msg = if (res.offline) "Zapisano lokalnie · ${choice.value}" else "$successMsg · ${choice.value}",
                        queueId = res.queueId,
                        bufferId = res.bufferId,
                        warn = warn,
                    )
                )
            } catch (e: Exception) {
                graph.effects.toast(e.message ?: "Błąd zapisu")
            } finally {
                saving = false
            }
        }
    }

    ScanHandlerEffect { scan ->
        val card = p
        if (card == null || scan.kind != ScanKind.LOC) return@ScanHandlerEffect false
        val err = validateLoc(scan.code, locInfo)
        when {
            err != null -> {
                graph.effects.toast(err)
                graph.feedback.beep(false)
            }
            scan.code in card.locs -> graph.effects.toast("Towar już ma lokalizację ${scan.code}")
            card.locs.size > 1 -> pendingLoc = scan.code
            else -> saveLoc(LocChoice(LocAction.REPLACE, scan.code), "Lokalizacja zapisana")
        }
        true
    }

    if (p == null) {
        LoadingRow("Wczytywanie karty…")
        return
    }

    val locStr = p.locs.joinToString(" ")
    val noMgp = p.mgp.stan == 0.0
    val hasPendingMM = p.mgp.pendingOut > 0

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        // nagłówek
        Column {
            Text(p.name, fontWeight = FontWeight.Bold, fontSize = 16.sp, color = Ink, lineHeight = 20.sp)
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.padding(top = 3.dp)) {
                Text(p.sym, fontWeight = FontWeight.Bold, fontSize = 12.sp, color = Ink)
                Text("EAN ${p.ean.ifEmpty { "—" }}", fontSize = 12.sp, color = InkSoft)
                Text(p.unit, fontSize = 12.sp, color = InkSoft)
            }
            if (p.desc.isNotEmpty()) {
                Text(p.desc, fontSize = 11.5.sp, color = InkMute, maxLines = 2, modifier = Modifier.padding(top = 4.dp))
            }
        }

        // stany MAG / MGP / Zwroty
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            StockCard(
                label = "MAG · DOSTĘPNE",
                value = p.mag.avail,
                sub = "rez. ${formatQty(p.mag.rez)} · razem ${formatQty(p.mag.stan)}",
                highlight = false,
                unit = p.unit,
                modifier = Modifier.weight(1f),
            )
            StockCard(
                label = "MGP · STREFA PRZYJĘĆ",
                value = p.mgp.stan,
                sub = when {
                    p.mgp.stan > 0 -> "do zasilenia MAG"
                    p.ordered > 0 -> "zam. u dostawcy: ${formatQty(p.ordered)}"
                    else -> "strefa przyjęć pusta"
                },
                highlight = p.mgp.stan > 0,
                unit = p.unit,
                modifier = Modifier.weight(1f),
            )
        }
        if ((p.zwroty?.stan ?: 0.0) > 0) {
            StockCard(
                label = "ZWROTY OD KLIENTÓW",
                value = p.zwroty!!.stan,
                sub = "czeka na rozłożenie (karton zwrotów)",
                highlight = true,
                unit = p.unit,
                modifier = Modifier.fillMaxWidth(),
            )
        }

        if (hasPendingMM) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(10.dp))
                    .border(1.dp, AmberLine, RoundedCornerShape(10.dp))
                    .background(AmberBgSoft)
                    .padding(horizontal = 10.dp, vertical = 7.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(7.dp),
            ) {
                Icon(WIcons.Clock, null, tint = AmberInk, modifier = Modifier.size(16.dp))
                Text(
                    "W kolejce Sfery ${formatQty(p.mgp.pendingOut)} szt — stan uwzględni zapis za chwilę",
                    fontSize = 12.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = AmberInk,
                )
            }
        }

        // lokalizacje
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Bottom) {
                Text(
                    "LOKALIZACJE (pierwsza = pickingowa)",
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Bold,
                    letterSpacing = 1.sp,
                    color = InkMute,
                    modifier = Modifier.weight(1f),
                )
                Text(
                    "${locStr.length}/$LOC_LIMIT zn.",
                    fontSize = 10.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = if (locStr.length > 42) MaterialTheme.colorScheme.error else InkMute,
                )
            }
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                if (p.locs.isEmpty()) {
                    Text(
                        "brak lokalizacji",
                        fontSize = 13.sp,
                        color = InkMute,
                        modifier = Modifier
                            .clip(RoundedCornerShape(50))
                            .border(1.5.dp, BorderCol, RoundedCornerShape(50))
                            .padding(horizontal = 12.dp, vertical = 7.dp),
                    )
                }
                p.locs.forEachIndexed { i, code ->
                    LocChip(code, primary = i == 0) {
                        chipMenu = if (chipMenu == code) null else code
                    }
                }
            }
            chipMenu?.let { code ->
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(10.dp))
                        .border(1.dp, BorderCol, RoundedCornerShape(10.dp))
                        .background(CardWhite)
                        .padding(horizontal = 10.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Text("Lokalizacja", fontSize = 13.sp, color = Ink, modifier = Modifier.weight(1f))
                    Text(code, fontSize = 13.sp, fontWeight = FontWeight.Bold, color = Ink)
                    OutlineButton("USUŃ", danger = true, enabled = !saving) {
                        scope.launch {
                            try {
                                apiCall { graph.api.setLocation(id, SetLocationBody(LocAction.REMOVE, value = code)) }
                                graph.queueRepo.refreshNow()
                                chipMenu = null
                                graph.effects.flashSuccess("Lokalizacja usunięta")
                            } catch (e: Exception) {
                                graph.effects.toast(e.message ?: "Błąd zapisu")
                            }
                        }
                    }
                    Icon(
                        WIcons.Close,
                        contentDescription = "Zamknij",
                        tint = InkMute,
                        modifier = Modifier.clickable { chipMenu = null }.padding(4.dp).size(18.dp),
                    )
                }
            }
        }

        // historia (ostatnie 4)
        if (history.isNotEmpty()) {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                SectionLabel("Historia")
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .cardSurface()
                        .padding(horizontal = 10.dp, vertical = 8.dp),
                    verticalArrangement = Arrangement.spacedBy(3.dp),
                ) {
                    history.take(4).forEach { h ->
                        Row {
                            Text(
                                h.detail.ifEmpty { h.type },
                                fontSize = 11.5.sp,
                                color = InkSoft,
                                maxLines = 1,
                                modifier = Modifier.weight(1f),
                            )
                            Text(
                                "${h.user} · ${h.at.drop(5).take(5)} ${h.at.drop(11).take(5)}",
                                fontSize = 11.sp,
                                color = InkMute,
                            )
                        }
                    }
                }
            }
        }

        Spacer(Modifier.height(2.dp))
        Text(
            "skan etykiety regału = przenieś tutaj · skan towaru = następna karta",
            fontSize = 11.sp,
            color = InkMute,
            modifier = Modifier.fillMaxWidth(),
            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
        )

        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlineButton("ZMIEŃ LOKALIZACJĘ", tall = true, leadingIcon = WIcons.Pin, modifier = Modifier.weight(1f)) {
                graph.nav.openScanLoc()
            }
            OutlineButton("MM MGP → MAG", tall = true, leadingIcon = WIcons.Transfer, modifier = Modifier.weight(1f)) {
                if (noMgp) graph.effects.toast("Brak stanu na MGP") else graph.nav.openMM()
            }
        }
    }

    LocChoiceSheet(
        product = p,
        code = pendingLoc,
        onClose = { pendingLoc = null },
        onPick = ::saveLoc,
    )
}

@Composable
private fun StockCard(label: String, value: Double, sub: String, highlight: Boolean, unit: String = "", modifier: Modifier = Modifier) {
    Column(
        modifier = modifier
            .cardSurface(
                background = if (highlight) AmberBg else CardWhite,
                borderColor = if (highlight) AmberLine else CardBorder,
            )
            .padding(12.dp),
    ) {
        Text(label, fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.2.sp, color = InkSoft)
        Row(verticalAlignment = Alignment.Bottom) {
            Text(
                formatQty(value),
                fontFamily = BarlowCond,
                fontWeight = FontWeight.ExtraBold,
                fontSize = 36.sp,
                lineHeight = 38.sp,
                color = if (highlight) AmberInk else Ink,
            )
            if (unit.isNotEmpty()) {
                Text(
                    unit,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = InkMute,
                    modifier = Modifier.padding(start = 4.dp, bottom = 5.dp),
                )
            }
        }
        Text(sub, fontSize = 11.sp, color = InkSoft)
    }
}
