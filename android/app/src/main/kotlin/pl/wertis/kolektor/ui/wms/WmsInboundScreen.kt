package pl.wertis.kolektor.ui.wms

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.launch
import pl.wertis.kolektor.AppGraph
import pl.wertis.kolektor.core.wms.WmsInboundDraft
import pl.wertis.kolektor.core.wms.WmsInboundScan
import pl.wertis.kolektor.core.wms.WmsInboundStage
import pl.wertis.kolektor.core.wms.inboundClose
import pl.wertis.kolektor.core.wms.inboundDestinationCode
import pl.wertis.kolektor.core.wms.inboundQuantity
import pl.wertis.kolektor.core.wms.inboundReceive
import pl.wertis.kolektor.core.wms.inboundStage
import pl.wertis.kolektor.scan.ScanHandlerEffect
import pl.wertis.kolektor.scan.WedgeKeySource
import pl.wertis.kolektor.ui.components.OutlineButton
import pl.wertis.kolektor.ui.components.PrimaryButton
import pl.wertis.kolektor.ui.components.WertisTextField
import pl.wertis.kolektor.ui.product.MiniaturaTowaru
import pl.wertis.kolektor.ui.theme.Amber
import pl.wertis.kolektor.ui.theme.Ink
import pl.wertis.kolektor.ui.theme.InkMute

@Composable
fun WmsInboundScreen(graph: AppGraph) {
    val session by graph.session.state.collectAsStateWithLifecycle()
    val settings by graph.settings.settings.collectAsStateWithLifecycle()
    val context = remember(session, settings.serverUrl) { graph.wmsRepo.context() }
    val controller = graph.wmsRepo.receiving
    val view by controller.state.collectAsStateWithLifecycle()
    val document = view.document.takeIf { view.context == context }
    val line = document?.selected
    var scan by remember(view.generation, context) { mutableStateOf(WmsInboundScan(barcode = view.confirmedBarcode)) }
    // Ilość oczekiwana nie jest dowodem dostawy; operator wpisuje faktycznie policzone sztuki.
    var quantity by remember(view.generation, context) { mutableStateOf("") }
    var error by remember(view.generation, context) { mutableStateOf<String?>(null) }
    var damaged by remember(view.generation, context) { mutableStateOf(false) }
    var options by remember(view.generation, context) { mutableStateOf(false) }
    var manualCode by remember(view.generation, context) { mutableStateOf("") }
    var query by remember(view.query, context) { mutableStateOf(view.query) }
    val stage = document?.let { inboundStage(it, scan) }
    val allowed = context != null && view.context == context && view.ready && !view.busy && view.journal.pending == null

    LaunchedEffect(context) { context?.let { controller.open(it) } }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    DisposableEffect(lifecycle, context) {
        var paused = false
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_PAUSE) { paused = true; controller.invalidateVerification() }
            else if (event == Lifecycle.Event.ON_RESUME && paused) {
                paused = false
                context?.let { bound -> graph.appScope.launch { controller.open(bound) } }
            }
        }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer); controller.invalidateVerification() }
    }
    DisposableEffect(Unit) { WedgeKeySource.wmsMode(true); onDispose { WedgeKeySource.wmsMode(false) } }

    fun submit(draft: WmsInboundDraft) {
        val bound = context ?: return
        error = null
        graph.appScope.launch {
            controller.submit(bound, draft)
            val result = controller.state.value
            if (result.context == bound && result.ready && result.message == null) graph.feedback.zapis() else graph.feedback.beep(false)
        }
    }
    fun search() {
        val bound = context ?: return
        graph.appScope.launch {
            if (document == null) controller.documents(bound, query.trim())
            else controller.document(bound, document.document.id, query.trim())
        }
    }
    fun confirmQuantity() {
        if (!allowed || line == null) return
        try { scan = inboundQuantity(line, scan, quantity); error = null; graph.feedback.beep(true) }
        catch (e: IllegalArgumentException) { error = e.message; graph.feedback.beep(false) }
    }
    fun findPart(code: String) {
        val bound = context ?: return
        if (!allowed) return
        if (code.isBlank()) { error = "Wpisz kod z etykiety części"; return }
        graph.appScope.launch {
            controller.scan(bound, code)
            graph.feedback.beep(controller.state.value.ready && controller.state.value.message == null)
        }
    }

    ScanHandlerEffect { input ->
        // Skan identyfikuje część w dokumencie, a nie zapamiętany wcześniej wiersz.
        if (!allowed || controller.state.value.busy || view.generation != controller.state.value.generation) {
            error = "Najpierw potwierdź wynik ostatniej operacji"; graph.feedback.beep(false)
        } else if (document == null) {
            query = input.rawCode.trim(); search()
        } else when (stage) {
            WmsInboundStage.PRODUCT, WmsInboundStage.COMPLETE -> findPart(input.rawCode)
            WmsInboundStage.DESTINATION -> {
                try { submit(inboundReceive(document, scan, inboundDestinationCode(input), view.buffer, damaged)) }
                catch (e: IllegalArgumentException) { error = e.message; graph.feedback.beep(false) }
            }
            WmsInboundStage.QUANTITY -> { error = "Najpierw potwierdź policzoną ilość"; graph.feedback.beep(false) }
            else -> { error = "Przyjęcie jest zamknięte. Wybierz kolejny dokument"; graph.feedback.beep(false) }
        }
        true
    }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        if (context == null) { Text("Zaloguj się, aby przyjmować dostawy."); return@Column }
        if ((!allowed && !view.busy) || (view.busy && document == null)) {
            Text(if (view.busy) "Potwierdzam na serwerze…" else "Przyjęcie wstrzymane", fontSize = 22.sp, fontWeight = FontWeight.Bold)
            Text(view.message ?: "Odczytuję przyjęcie…")
            val pending = view.journal.pending
            if (pending != null) WmsPendingNotice(graph, pending, context, "receiving", view.busy) {
                graph.appScope.launch { controller.retry(context) }
            } else {
                PrimaryButton("ODŚWIEŻ", enabled = !view.busy, modifier = Modifier.fillMaxWidth()) { graph.appScope.launch { controller.open(context) } }
                OutlineButton("LISTA PRZYJĘĆ", enabled = !view.busy, modifier = Modifier.fillMaxWidth()) { graph.appScope.launch { controller.documents(context) } }
            }
            return@Column
        }
        if (document == null) {
            Text("Oczekiwane dostawy · ${view.documents?.total ?: 0}", fontSize = 22.sp, fontWeight = FontWeight.Bold)
            Text("Skanuj numer przyjęcia lub wyszukaj dostawcę.", color = InkMute)
            WertisTextField(query, { query = it.take(120) }, placeholder = "Numer / dostawca", onDone = ::search)
            PrimaryButton("SZUKAJ", enabled = allowed, modifier = Modifier.fillMaxWidth(), onClick = ::search)
            if (view.documents?.rows?.isEmpty() == true) Text("Brak otwartych przyjęć dla tego filtra.")
            view.documents?.rows?.forEach { row ->
                OutlineButton("${row.reference}\n${row.supplier} · ${row.remaining} szt. do policzenia", enabled = allowed, modifier = Modifier.fillMaxWidth()) {
                    graph.appScope.launch { controller.document(context, row.id) }
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlineButton("POPRZEDNIE", enabled = allowed && view.offset > 0, modifier = Modifier.weight(1f)) {
                    graph.appScope.launch { controller.documents(context, view.query, (view.offset - 50).coerceAtLeast(0)) }
                }
                OutlineButton("NASTĘPNE", enabled = allowed && view.offset + 50 < (view.documents?.total ?: 0), modifier = Modifier.weight(1f)) {
                    graph.appScope.launch { controller.documents(context, view.query, view.offset + 50) }
                }
            }
            return@Column
        }

        Text("${document.document.reference} · ${if (view.buffer) "DO BUFORA" else "NA PÓŁKĘ"}", color = InkMute, fontSize = 14.sp)
        val prompt = if (view.busy) "ZAPISUJĘ — ZACZEKAJ NA SYGNAŁ" else when (stage) {
            WmsInboundStage.PRODUCT -> "1 · SKANUJ CZĘŚĆ Z DOSTAWY"
            WmsInboundStage.QUANTITY -> "2 · POLICZ PRZYJMOWANE SZTUKI"
            WmsInboundStage.DESTINATION -> if (damaged) "3 · SKANUJ KWARANTANNĘ" else if (view.buffer) "3 · ODŁÓŻ I SKANUJ BUFOR" else "3 · ODŁÓŻ I SKANUJ PÓŁKĘ"
            WmsInboundStage.COMPLETE -> "TA POZYCJA JEST JUŻ POLICZONA"
            else -> "PRZYJĘCIE ZAMKNIĘTE"
        }
        Text(prompt, Modifier.fillMaxWidth().background(Amber, RoundedCornerShape(10.dp)).padding(12.dp), color = Ink, fontSize = 20.sp, fontWeight = FontWeight.ExtraBold)
        if (line != null) {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                MiniaturaTowaru(graph, line.tw_id, 96.dp, powieksz = !view.busy, contentScale = ContentScale.Fit)
                Column(Modifier.weight(1f)) {
                    Text(line.sku, fontSize = 22.sp, fontWeight = FontWeight.ExtraBold)
                    Text(line.name, fontSize = 16.sp)
                    Text("Policzono ${line.received} / ${line.expected}", color = InkMute)
                }
            }
            when (stage) {
                WmsInboundStage.QUANTITY -> if (allowed) {
                    Text("Teraz przyjmujesz · pozostało ${line.remaining} szt.", fontWeight = FontWeight.Bold)
                    WertisTextField(quantity, { quantity = it.take(7) }, placeholder = "Policzona ilość", keyboardType = KeyboardType.Number, onDone = ::confirmQuantity)
                    PrimaryButton("POTWIERDŹ ILOŚĆ", modifier = Modifier.fillMaxWidth(), onClick = ::confirmQuantity)
                }
                WmsInboundStage.DESTINATION -> {
                    Text("${scan.quantity} szt. · ${if (damaged) "USZKODZONE" else "PEŁNOWARTOŚCIOWE"}", fontSize = 26.sp, fontWeight = FontWeight.ExtraBold)
                    if (!view.buffer && !damaged && line.bins.isNotEmpty()) Text("Znane półki: ${line.bins.joinToString { it.bin }}", color = InkMute)
                    Text("Skan lokalizacji zapisze pokazaną ilość.")
                }
                WmsInboundStage.COMPLETE -> Text("Skan nie dopisał towaru ponownie. Zeskanuj kolejną część; nadwyżkę zgłoś biuru.")
                WmsInboundStage.PRODUCT -> Text("Stan odświeżony. Możesz zeskanować tę część ponownie lub kolejną pozycję dostawy.")
                else -> Unit
            }
        }
        (error ?: view.message)?.let { Text(it, fontWeight = FontWeight.Bold) }
        if (document.summary.remaining == 0L && stage != WmsInboundStage.CLOSED) {
            PrimaryButton("ZAKOŃCZ PRZYJĘCIE", enabled = allowed, modifier = Modifier.fillMaxWidth()) { submit(inboundClose(document)) }
        }
        if (stage != WmsInboundStage.CLOSED) {
            OutlineButton(if (options) "ZAMKNIJ OPCJE" else "PROBLEM / TRYB / DOKUMENT", enabled = allowed, modifier = Modifier.fillMaxWidth()) { options = !options }
            if (options && allowed) {
                if (stage in setOf(WmsInboundStage.PRODUCT, WmsInboundStage.COMPLETE)) {
                    Text("Nieczytelny lub wspólny EAN? Odczytaj SKU z etykiety części.")
                    WertisTextField(manualCode, { manualCode = it.take(120) }, placeholder = "Wpisz kod z etykiety", onDone = { findPart(manualCode) })
                    OutlineButton("SPRAWDŹ WPISANY KOD", modifier = Modifier.fillMaxWidth()) { findPart(manualCode) }
                }
                if (line != null && scan.barcode != null && line.remaining > 0) {
                    OutlineButton(if (damaged) "PEŁNOWARTOŚCIOWY TOWAR" else "USZKODZONY TOWAR", modifier = Modifier.fillMaxWidth()) {
                        damaged = !damaged; scan = scan.copy(quantity = null); options = false
                    }
                    OutlineButton("ZMIEŃ ILOŚĆ", modifier = Modifier.fillMaxWidth()) { scan = scan.copy(quantity = null); options = false }
                }
                OutlineButton(if (view.buffer) "ZMIEŃ NA PRZYJĘCIE OD RAZU NA PÓŁKĘ" else "ZMIEŃ NA PRZYJĘCIE DO BUFORA", modifier = Modifier.fillMaxWidth()) {
                    graph.appScope.launch { controller.setBuffer(context, !view.buffer) }
                }
                Text("Nadwyżkę, nieznany towar lub brak zgłoś biuru. Nie dopisuj ich pod innym SKU.")
                OutlineButton("POKAŻ POZYCJE DOKUMENTU", modifier = Modifier.fillMaxWidth()) {
                    graph.appScope.launch { controller.document(context, document.document.id) }
                }
            }
        }
        if (line == null || stage == WmsInboundStage.CLOSED) {
            Text("Cała dostawa: ${document.summary.received} / ${document.summary.expected} szt. · ${document.summary.remaining} pozostało", fontWeight = FontWeight.Bold)
            if (stage != WmsInboundStage.CLOSED) {
                WertisTextField(query, { query = it.take(120) }, placeholder = "Filtr pozycji: SKU, EAN, nazwa", onDone = ::search)
                OutlineButton("FILTRUJ POZYCJE", enabled = allowed, modifier = Modifier.fillMaxWidth(), onClick = ::search)
                document.lines.forEach { row ->
                    OutlineButton("${row.sku} · ${row.received}/${row.expected} szt.\n${row.name}", enabled = allowed, modifier = Modifier.fillMaxWidth()) {
                        graph.appScope.launch { controller.document(context, document.document.id, lineId = row.id) }
                    }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    OutlineButton("POPRZEDNIE", enabled = allowed && view.offset > 0, modifier = Modifier.weight(1f)) {
                        graph.appScope.launch { controller.document(context, document.document.id, view.query, (view.offset - 50).coerceAtLeast(0)) }
                    }
                    OutlineButton("NASTĘPNE", enabled = allowed && view.offset + 50 < document.total, modifier = Modifier.weight(1f)) {
                        graph.appScope.launch { controller.document(context, document.document.id, view.query, view.offset + 50) }
                    }
                }
            }
        }
        OutlineButton("LISTA PRZYJĘĆ", enabled = allowed, modifier = Modifier.fillMaxWidth()) { graph.appScope.launch { controller.documents(context) } }
    }
}
