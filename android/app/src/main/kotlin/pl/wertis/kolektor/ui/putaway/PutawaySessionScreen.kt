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
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.launch
import pl.wertis.kolektor.AppGraph
import pl.wertis.kolektor.core.loc.normalizeLoc
import pl.wertis.kolektor.core.nav.Screen
import pl.wertis.kolektor.core.net.CartBody
import pl.wertis.kolektor.core.net.CartRemoveBody
import pl.wertis.kolektor.core.net.ConfirmBody
import pl.wertis.kolektor.core.net.PutawayItem
import pl.wertis.kolektor.core.net.PutawayItemStatus
import pl.wertis.kolektor.core.net.PutawaySession
import pl.wertis.kolektor.core.net.PutawayZone
import pl.wertis.kolektor.core.net.ScanResult
import pl.wertis.kolektor.core.net.SkipBody
import pl.wertis.kolektor.core.scan.ScanKind
import pl.wertis.kolektor.data.Poll
import pl.wertis.kolektor.data.pollFlow
import pl.wertis.kolektor.net.apiCall
import pl.wertis.kolektor.scan.ScanHandlerEffect
import pl.wertis.kolektor.ui.components.LoadingRow
import pl.wertis.kolektor.ui.components.OutlineButton
import pl.wertis.kolektor.ui.components.PrimaryButton
import pl.wertis.kolektor.ui.components.formatQty
import pl.wertis.kolektor.ui.theme.Amber
import pl.wertis.kolektor.ui.theme.AmberBg
import pl.wertis.kolektor.ui.theme.AmberBgSoft
import pl.wertis.kolektor.ui.theme.AmberInk
import pl.wertis.kolektor.ui.theme.BarlowCond
import pl.wertis.kolektor.ui.theme.BorderCol
import pl.wertis.kolektor.ui.theme.CardWhite
import pl.wertis.kolektor.ui.theme.Destructive
import pl.wertis.kolektor.ui.theme.Ink
import pl.wertis.kolektor.ui.theme.InkMute
import pl.wertis.kolektor.ui.theme.InkSoft
import pl.wertis.kolektor.ui.theme.Paper
import pl.wertis.kolektor.ui.theme.Secondary
import pl.wertis.kolektor.ui.theme.Success

/* ── Sesja rozkładania (tryb wózka) — port putaway/Session.tsx ──────────────
   Pozycje posortowane po lokalizacji docelowej (serwer), BRAK LOK na końcu.
   Skany: EAN → na wózek (spoza dokumentu = dialog potwierdzenia); etykieta
   lokalizacji → potwierdzenie pierwszej pozycji wózka czekającej na miejsce.
   ZATWIERDŹ WÓZEK → jeden MM + zadania set_location; tryb marszu pokazuje
   wielką kartę następnego celu.                                              */

@Composable
fun PutawaySessionScreen(graph: AppGraph) {
    val sid = graph.nav.sessionId ?: return
    val scope = rememberCoroutineScope()

    val kick = remember(sid) { MutableSharedFlow<Unit>(extraBufferCapacity = 1, onBufferOverflow = BufferOverflow.DROP_OLDEST) }
    val poll by remember(sid) { pollFlow(2000, kick) { apiCall { graph.api.session(sid) } } }
        .collectAsState(initial = Poll())
    val sess = poll.data
    fun refresh() = kick.tryEmit(Unit)

    var walkTarget by remember { mutableStateOf<Triple<String, String, Double>?>(null) }
    var offDocAsk by remember { mutableStateOf<Triple<Long, String, String>?>(null) } // twId, sym, name

    suspend fun putOnCart(twId: Long, offDocument: Boolean = false) {
        try {
            val r = apiCall { graph.api.cart(sid, CartBody(twId, offDocument = if (offDocument) true else null)) }
            when {
                r.error != null -> graph.effects.toast(r.error!!)
                r.locked == true -> graph.effects.toast("Pozycja na wózku innej osoby: ${r.lockedBy}")
                r.offDocument == true && !offDocument ->
                    offDocAsk = Triple(r.twId ?: twId, r.sym ?: "", r.name ?: "")
                else -> {
                    graph.feedback.beep(true)
                    refresh()
                }
            }
        } catch (e: Exception) {
            graph.effects.toast(e.message ?: "Błąd")
        }
    }

    // Skany w sesji: EAN → na wózek; etykieta → potwierdź pozycję czekającą na miejsce
    ScanHandlerEffect { scan ->
        val s = sess ?: return@ScanHandlerEffect false
        when (scan.kind) {
            ScanKind.EAN -> {
                scope.launch {
                    try {
                        when (val r = apiCall { graph.api.scan(scan.code) }) {
                            is ScanResult.Product -> putOnCart(r.card.id)
                            else -> {
                                graph.feedback.beep(false)
                                graph.effects.toast("Nieznany kod: ${scan.code}")
                            }
                        }
                    } catch (_: Exception) {
                        graph.effects.toast("Błąd połączenia z serwerem")
                    }
                }
                true
            }
            ScanKind.LOC -> {
                val target = s.items.firstOrNull { it.status == PutawayItemStatus.ON_CART && it.stageLoc == null }
                    ?: s.items.firstOrNull { it.status == PutawayItemStatus.ON_CART }
                if (target == null) return@ScanHandlerEffect false // nic na wózku → fallback (podgląd lokalizacji)
                scope.launch {
                    try {
                        val qty = target.stageQty ?: minOf(
                            target.delta.takeIf { it > 0 } ?: target.qtyExpected,
                            target.mgpStan,
                        ).coerceAtLeast(1.0)
                        val r = apiCall {
                            graph.api.confirm(sid, ConfirmBody(target.id, qty, normalizeLoc(scan.code), updateLoc = true))
                        }
                        if (r.error != null) {
                            graph.effects.toast(r.error!!)
                            graph.feedback.beep(false)
                        } else {
                            graph.feedback.beep(true)
                            refresh()
                        }
                    } catch (e: Exception) {
                        graph.effects.toast(e.message ?: "Błąd")
                    }
                }
                true
            }
            else -> false
        }
    }

    if (sess == null) {
        LoadingRow("Wczytywanie sesji…")
        return
    }

    val cart = sess.items.filter { it.status == PutawayItemStatus.ON_CART }
    // częściowo rozłożone wracają do „Do rozłożenia” — delta czeka na kolejną rundę
    val pending = sess.items.filter { it.status == PutawayItemStatus.PENDING || it.status == PutawayItemStatus.PARTIAL }
    val doneItems = sess.items.filter { it.status == PutawayItemStatus.DONE || it.status == PutawayItemStatus.SKIPPED }

    fun commit() {
        scope.launch {
            try {
                val r = apiCall { graph.api.commitCart(sid) }
                graph.queueRepo.refreshNow()
                refresh()
                graph.feedback.beep(true)
                graph.effects.flashSuccess("Wózek zatwierdzony (${r.committed})")
                val next = sess.items.firstOrNull { it.status == PutawayItemStatus.PENDING && it.targetLoc != null }
                if (next != null && graph.settings.current.walkMode) {
                    walkTarget = Triple(next.targetLoc!!, next.sym, next.delta.takeIf { it > 0 } ?: next.qtyExpected)
                }
            } catch (e: Exception) {
                graph.effects.toast(e.message ?: "Nie udało się zatwierdzić")
            }
        }
    }

    fun closeSession() {
        scope.launch {
            try {
                val r = apiCall { graph.api.closeSession(sid) }
                graph.effects.toast(
                    "Sesja zamknięta: ${r.summary["done"] ?: 0} rozłożone, " +
                        "${r.summary["partial"] ?: 0} częściowe, ${r.summary["skipped"] ?: 0} pominięte"
                )
                graph.nav.go(Screen.PUTAWAY_DOCS)
            } catch (e: Exception) {
                graph.effects.toast(e.message ?: "Błąd zamknięcia")
            }
        }
    }

    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            SessionHeader(sess)

            Column(
                modifier = Modifier
                    .weight(1f)
                    .verticalScroll(rememberScrollState())
                    .padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                // BŁĘDY KOLEJKI — MM/lokalizacja nie weszły do Subiekta mimo odhaczenia
                if (sess.queueAlerts.isNotEmpty()) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(12.dp))
                            .border(2.dp, Destructive, RoundedCornerShape(12.dp))
                            .background(Destructive.copy(alpha = 0.08f))
                            .padding(10.dp),
                        verticalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Text(
                            "⚠ NIE ZAPISANO W SUBIEKCIE (${sess.queueAlerts.size})",
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Bold,
                            letterSpacing = 1.sp,
                            color = Destructive,
                        )
                        sess.queueAlerts.forEach { a ->
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(10.dp))
                                    .border(1.dp, BorderCol, RoundedCornerShape(10.dp))
                                    .background(CardWhite)
                                    .padding(horizontal = 10.dp, vertical = 7.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                Column(Modifier.weight(1f)) {
                                    Text(a.label, fontFamily = BarlowCond, fontWeight = FontWeight.Bold, fontSize = 14.sp, color = Ink)
                                    Text(
                                        a.errorMsg ?: a.detail,
                                        fontSize = 11.sp,
                                        color = InkSoft,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                    )
                                }
                                OutlineButton("PONÓW") {
                                    scope.launch {
                                        try {
                                            apiCall { graph.api.retry(a.id) }
                                            graph.queueRepo.refreshNow()
                                            refresh()
                                        } catch (e: Exception) {
                                            graph.effects.toast(e.message ?: "Błąd")
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                // WÓZEK
                if (cart.isNotEmpty()) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(12.dp))
                            .border(2.dp, Amber, RoundedCornerShape(12.dp))
                            .background(AmberBgSoft)
                            .padding(10.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Text(
                            "NA WÓZKU (${cart.size})",
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Bold,
                            letterSpacing = 1.sp,
                            color = AmberInk,
                        )
                        cart.forEach { item ->
                            CartRow(graph, sid, item, sess.zone, onChange = ::refresh)
                        }
                        PrimaryButton(
                            "ZATWIERDŹ WÓZEK (${cart.size}) → MM + LOKALIZACJE",
                            tall = true,
                            modifier = Modifier.fillMaxWidth(),
                        ) { commit() }
                    }
                }

                // DO ROZŁOŻENIA
                if (pending.isNotEmpty()) {
                    Text(
                        "DO ROZŁOŻENIA — SKANUJ LUB DOTKNIJ, ABY WZIĄĆ NA WÓZEK",
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold,
                        letterSpacing = 1.sp,
                        color = InkMute,
                    )
                    pending.forEach { item ->
                        PendingRow(item) { scope.launch { putOnCart(item.twId) } }
                    }
                }

                // ZAŁATWIONE
                if (doneItems.isNotEmpty()) {
                    Text("ZAŁATWIONE", fontSize = 11.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.sp, color = InkMute)
                    doneItems.forEach { item -> DoneRow(item) }
                }

                if (pending.isEmpty() && cart.isEmpty()) {
                    OutlineButton("ZAMKNIJ SESJĘ I ROZLICZ", tall = true, modifier = Modifier.fillMaxWidth()) {
                        closeSession()
                    }
                }
            }
        }

        // Tryb marszu: wielka karta celu — czytelna w ruchu, znika po dotknięciu
        walkTarget?.let { (loc, sym, qty) ->
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .background(Paper.copy(alpha = 0.97f))
                    .clickable { walkTarget = null }
                    .padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                Text("NASTĘPNE", fontSize = 12.sp, fontWeight = FontWeight.Bold, letterSpacing = 2.sp, color = InkMute)
                Text(
                    loc,
                    fontFamily = BarlowCond,
                    fontWeight = FontWeight.ExtraBold,
                    fontSize = 52.sp,
                    color = AmberInk,
                    textAlign = TextAlign.Center,
                )
                Text(sym, fontFamily = BarlowCond, fontWeight = FontWeight.Bold, fontSize = 20.sp, color = Ink)
                Text("${formatQty(qty)} szt", fontSize = 14.sp, color = InkSoft)
                Text("dotknij, aby wrócić do listy", fontSize = 11.sp, color = InkMute, modifier = Modifier.padding(top = 10.dp))
            }
        }
    }

    // towar spoza dokumentu — potwierdzenie dodania (spec §5.4 pkt 5)
    offDocAsk?.let { (twId, sym, name) ->
        AlertDialog(
            onDismissRequest = { offDocAsk = null },
            containerColor = CardWhite,
            title = { Text("Spoza dokumentu", fontWeight = FontWeight.Bold) },
            text = { Text("$sym — $name\nTego towaru nie ma na dokumencie. Dodać do sesji?") },
            confirmButton = {
                PrimaryButton("DODAJ") {
                    offDocAsk = null
                    scope.launch { putOnCart(twId, offDocument = true) }
                }
            },
            dismissButton = {
                OutlineButton("ANULUJ") { offDocAsk = null }
            },
        )
    }
}

@Composable
private fun SessionHeader(sess: PutawaySession) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(CardWhite)
            .padding(horizontal = 12.dp, vertical = 8.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                sess.sourceDocNumber ?: "Całe MGP",
                fontFamily = BarlowCond,
                fontWeight = FontWeight.Bold,
                fontSize = 15.sp,
                color = Ink,
            )
            if (sess.zone == PutawayZone.ZWROTY) {
                Text(
                    "ZWROTY",
                    fontSize = 10.sp,
                    fontWeight = FontWeight.Bold,
                    color = AmberInk,
                    modifier = Modifier
                        .padding(start = 6.dp)
                        .clip(RoundedCornerShape(6.dp))
                        .background(AmberBg)
                        .padding(horizontal = 6.dp, vertical = 1.dp),
                )
            }
            Row(Modifier.weight(1f), horizontalArrangement = Arrangement.End, verticalAlignment = Alignment.CenterVertically) {
                if (sess.inFlight > 0) {
                    Text("⏳ ${sess.inFlight}  ", fontSize = 12.sp, color = InkSoft, fontWeight = FontWeight.SemiBold)
                }
                Text(
                    "zostało ${sess.progress.remaining}/${sess.progress.total} poz.",
                    fontSize = 12.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = InkSoft,
                )
            }
        }
        // pasek postępu
        Box(
            Modifier
                .fillMaxWidth()
                .padding(top = 5.dp)
                .height(6.dp)
                .clip(RoundedCornerShape(50))
                .background(Secondary),
        ) {
            val pct = if (sess.progress.total > 0) sess.progress.done.toFloat() / sess.progress.total else 0f
            Box(
                Modifier
                    .fillMaxWidth(pct)
                    .height(6.dp)
                    .clip(RoundedCornerShape(50))
                    .background(Amber),
            )
        }
    }
}

@Composable
private fun PendingRow(item: PutawayItem, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .border(1.dp, BorderCol, RoundedCornerShape(10.dp))
            .background(CardWhite)
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Column(Modifier.weight(1f)) {
            Text(item.sym, fontFamily = BarlowCond, fontWeight = FontWeight.Bold, fontSize = 14.sp, color = Ink)
            Text(item.name, fontSize = 12.sp, color = InkSoft, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Column(horizontalAlignment = Alignment.End) {
            if (item.targetLoc != null) {
                Text(
                    item.targetLoc!!,
                    fontFamily = BarlowCond,
                    fontWeight = FontWeight.Bold,
                    fontSize = 12.sp,
                    color = Ink,
                    modifier = Modifier.clip(RoundedCornerShape(6.dp)).background(Secondary).padding(horizontal = 6.dp, vertical = 2.dp),
                )
            } else {
                Text(
                    "BRAK LOK",
                    fontFamily = BarlowCond,
                    fontWeight = FontWeight.Bold,
                    fontSize = 12.sp,
                    color = CardWhite,
                    modifier = Modifier.clip(RoundedCornerShape(6.dp)).background(Destructive).padding(horizontal = 6.dp, vertical = 2.dp),
                )
            }
            Text(
                if (item.status == PutawayItemStatus.PARTIAL) "zostało ${formatQty(item.delta)} z ${formatQty(item.qtyExpected)}"
                else "${formatQty(item.qtyExpected)} szt",
                fontSize = 11.sp,
                color = InkMute,
            )
        }
    }
}

@Composable
private fun DoneRow(item: PutawayItem) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .border(1.dp, BorderCol, RoundedCornerShape(10.dp))
            .background(CardWhite.copy(alpha = 0.6f))
            .padding(horizontal = 12.dp, vertical = 7.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(item.sym, fontFamily = BarlowCond, fontWeight = FontWeight.Bold, fontSize = 14.sp, color = Ink)
            Text(
                when (item.status) {
                    PutawayItemStatus.DONE -> "rozłożono ${formatQty(item.qtyDone)} szt"
                    PutawayItemStatus.PARTIAL -> "częściowo ${formatQty(item.qtyDone)}/${formatQty(item.qtyExpected)}"
                    PutawayItemStatus.SKIPPED -> "pominięto" + (item.skipReason?.let { r -> " · $r" } ?: "")
                    else -> ""
                },
                fontSize = 11.sp,
                color = InkMute,
            )
        }
        Text(
            if (item.status == PutawayItemStatus.SKIPPED) "⏭" else "✓",
            fontSize = 16.sp,
            fontWeight = FontWeight.Bold,
            color = if (item.status == PutawayItemStatus.SKIPPED) InkMute else Success,
        )
    }
}

/* Wiersz wózka: ilość, lokalizacja (skan lub POTWIERDŹ), pomiń, zdejmij. */
@Composable
private fun CartRow(graph: AppGraph, sid: Long, item: PutawayItem, zone: PutawayZone, onChange: () -> Unit) {
    val scope = rememberCoroutineScope()
    var qty by rememberSaveable(item.id) { mutableStateOf(item.stageQty ?: minOf(item.delta.takeIf { d -> d > 0 } ?: item.qtyExpected, item.mgpStan).coerceAtLeast(1.0)) }
    var loc by rememberSaveable(item.id) { mutableStateOf(item.stageLoc ?: item.targetLoc ?: "") }

    fun confirm(location: String) {
        if (location.isEmpty()) {
            graph.effects.toast("Zeskanuj lokalizację docelową")
            return
        }
        scope.launch {
            try {
                val r = apiCall { graph.api.confirm(sid, ConfirmBody(item.id, qty, location, updateLoc = true)) }
                if (r.error != null) {
                    graph.effects.toast(r.error!!)
                } else {
                    graph.feedback.beep(true)
                    onChange()
                }
            } catch (e: Exception) {
                graph.effects.toast(e.message ?: "Błąd")
            }
        }
    }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .border(1.dp, BorderCol, RoundedCornerShape(10.dp))
            .background(CardWhite)
            .padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(7.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Column(Modifier.weight(1f)) {
                Text(item.sym, fontFamily = BarlowCond, fontWeight = FontWeight.Bold, fontSize = 14.sp, color = Ink)
                Text(item.name, fontSize = 11.sp, color = InkSoft, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            if (loc.isNotEmpty()) {
                Text(
                    "📍$loc",
                    fontFamily = BarlowCond,
                    fontWeight = FontWeight.Bold,
                    fontSize = 12.sp,
                    color = AmberInk,
                    modifier = Modifier.clip(RoundedCornerShape(6.dp)).background(AmberBg).padding(horizontal = 6.dp, vertical = 2.dp),
                )
            } else {
                Text(
                    "wybierz lok.",
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Bold,
                    color = CardWhite,
                    modifier = Modifier.clip(RoundedCornerShape(6.dp)).background(Destructive).padding(horizontal = 6.dp, vertical = 2.dp),
                )
            }
        }

        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlineButton("−", modifier = Modifier.size(34.dp)) { qty = (qty - 1).coerceAtLeast(1.0) }
            Text(
                formatQty(qty),
                fontFamily = BarlowCond,
                fontWeight = FontWeight.ExtraBold,
                fontSize = 20.sp,
                color = Ink,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(horizontal = 4.dp),
            )
            OutlineButton("+", modifier = Modifier.size(34.dp)) {
                qty = (qty + 1).coerceAtMost(item.qtyExpected.takeIf { q -> q > 0 } ?: (qty + 1))
            }
            Text(
                "z ${if (item.qtyExpected > 0) formatQty(item.qtyExpected) else "—"} · ${if (zone == PutawayZone.ZWROTY) "ZWROTY" else "MGP"} ${formatQty(item.mgpStan)}",
                fontSize = 11.sp,
                color = InkMute,
                modifier = Modifier.weight(1f),
            )
            Text(
                "⏭",
                fontSize = 16.sp,
                color = InkMute,
                modifier = Modifier
                    .clickable {
                        scope.launch {
                            try {
                                apiCall { graph.api.skip(sid, SkipBody(item.id)) }
                                onChange()
                            } catch (e: Exception) {
                                graph.effects.toast(e.message ?: "Błąd")
                            }
                        }
                    }
                    .padding(4.dp),
            )
            Text(
                "↩",
                fontSize = 16.sp,
                color = InkMute,
                modifier = Modifier
                    .clickable {
                        scope.launch {
                            try {
                                apiCall { graph.api.cartRemove(sid, CartRemoveBody(item.id)) }
                                onChange()
                            } catch (e: Exception) {
                                graph.effects.toast(e.message ?: "Błąd")
                            }
                        }
                    }
                    .padding(4.dp),
            )
        }

        if (loc.isEmpty()) {
            Text("▮▮▯▮ Zeskanuj lokalizację docelową", fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = InkMute)
        } else {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                PrimaryButton("✓ POTWIERDŹ NA $loc", modifier = Modifier.weight(1f)) { confirm(loc) }
                OutlineButton("Inna lok.") { loc = "" }
            }
        }
    }
}
