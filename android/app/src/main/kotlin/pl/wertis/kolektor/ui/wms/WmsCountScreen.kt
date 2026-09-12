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
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.launch
import pl.wertis.kolektor.AppGraph
import pl.wertis.kolektor.core.wms.WmsCountDraft
import pl.wertis.kolektor.core.wms.WmsCountScan
import pl.wertis.kolektor.core.wms.WmsCountStage
import pl.wertis.kolektor.core.wms.countCode
import pl.wertis.kolektor.core.wms.countDraft
import pl.wertis.kolektor.core.wms.countScan
import pl.wertis.kolektor.core.wms.countStage
import pl.wertis.kolektor.ui.components.OutlineButton
import pl.wertis.kolektor.ui.components.PrimaryButton
import pl.wertis.kolektor.ui.components.WertisTextField
import pl.wertis.kolektor.ui.product.MiniaturaTowaru
import pl.wertis.kolektor.ui.theme.Amber
import pl.wertis.kolektor.ui.theme.Ink
import pl.wertis.kolektor.ui.theme.InkMute

@Composable
fun WmsCountScreen(graph: AppGraph) {
    val session by graph.session.state.collectAsStateWithLifecycle()
    val settings by graph.settings.settings.collectAsStateWithLifecycle()
    val context = remember(session, settings.serverUrl) { graph.wmsRepo.context() }
    val controller = graph.wmsRepo.counting
    val view by controller.state.collectAsStateWithLifecycle()
    val task = view.task.takeIf { view.context == context }
    var scan by remember(view.generation, context) { mutableStateOf(WmsCountScan()) }
    var quantity by remember(view.generation, context) { mutableStateOf("") }
    var error by remember(view.generation, context) { mutableStateOf<String?>(null) }
    var query by remember(view.query, context) { mutableStateOf(view.query) }
    val stage = task?.let { countStage(it, scan) }
    val allowed = view.context == context && context != null && view.ready && !view.busy && view.journal.pending == null
    WmsLifecycleEffect(graph, context, controller::activateVerification, controller::invalidateVerification, controller::open)

    fun search() {
        context?.let { bound -> graph.appScope.launch { controller.queue(bound, query) } }
    }
    fun submit(draft: WmsCountDraft) {
        val bound = context ?: return
        graph.appScope.launch {
            controller.submit(bound, draft)
            val result = controller.state.value
            if (result.context == bound && result.ready && result.message == null) graph.feedback.zapis()
            else graph.feedback.beep(false)
        }
    }
    fun confirm() {
        if (!allowed || task == null) return
        try { error = null; submit(countDraft(task, scan, quantity)) }
        catch (e: IllegalArgumentException) { error = e.message; graph.feedback.beep(false) }
    }
    WmsScanHandlerEffect { input ->
        if (allowed) {
            if (task == null) {
                query = if (input.kind == pl.wertis.kolektor.core.scan.ScanKind.LOC) input.code else input.rawCode
                search()
            } else try {
                scan = countScan(task, scan, countCode(stage!!, input))
                error = null
                graph.feedback.beep(true)
            } catch (e: IllegalArgumentException) { error = e.message; graph.feedback.beep(false) }
        }
        true
    }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        if (context == null) { Text("Zaloguj się, aby przeliczyć półkę."); return@Column }
        if (!allowed && !view.busy || view.busy && task == null) {
            Text(if (view.busy) "Potwierdzam na serwerze…" else "Przeliczenie wstrzymane", fontSize = 22.sp, fontWeight = FontWeight.Bold)
            Text(view.message ?: "Odczytuję zadanie…")
            val pending = view.journal.pending
            if (pending != null) WmsPendingNotice(graph, pending, context, "counting", view.busy) {
                graph.appScope.launch { controller.retry(context) }
            } else {
                PrimaryButton("ODŚWIEŻ", enabled = !view.busy, modifier = Modifier.fillMaxWidth()) { graph.appScope.launch { controller.open(context) } }
                OutlineButton("WRÓĆ DO KOLEJKI", enabled = !view.busy, modifier = Modifier.fillMaxWidth()) { graph.appScope.launch { controller.queue(context) } }
            }
            return@Column
        }
        if (task == null) {
            Text("${view.queue?.totals?.tasks ?: 0} półek do wyjaśnienia", fontWeight = FontWeight.Bold, fontSize = 22.sp)
            Text("Skanuj półkę lub część. Wynik liczenia zatwierdza biuro.", color = InkMute)
            WertisTextField(query, { query = it.take(120) }, placeholder = "Półka, SKU lub EAN", onDone = ::search)
            PrimaryButton("SZUKAJ", enabled = allowed, modifier = Modifier.fillMaxWidth(), onClick = ::search)
            if (view.queue?.rows?.isEmpty() == true) Text("Brak przeliczeń dla tego filtra.")
            view.queue?.rows?.forEach { row ->
                OutlineButton("${row.bin} · ${row.sku}\n${row.name}\n${if (row.pending != 0) "Wynik czeka na biuro" else "Do policzenia"}", enabled = allowed, modifier = Modifier.fillMaxWidth()) {
                    graph.appScope.launch { controller.select(context, row.id) }
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlineButton("POPRZEDNIE", enabled = allowed && view.offset > 0, modifier = Modifier.weight(1f)) {
                    graph.appScope.launch { controller.queue(context, view.query, (view.offset - 50).coerceAtLeast(0)) }
                }
                OutlineButton("NASTĘPNE", enabled = allowed && view.offset + 50 < (view.queue?.totals?.tasks ?: 0), modifier = Modifier.weight(1f)) {
                    graph.appScope.launch { controller.queue(context, view.query, view.offset + 50) }
                }
            }
            return@Column
        }
        val prompt = if (view.busy) "ZAPISUJĘ — ZACZEKAJ NA SYGNAŁ" else when (stage) {
            WmsCountStage.BIN -> "1 · SKANUJ PÓŁKĘ ${task.bin}"
            WmsCountStage.PRODUCT -> "2 · SKANUJ KOD CZĘŚCI"
            WmsCountStage.QUANTITY -> "3 · POLICZ SZTUKI NA PÓŁCE"
            WmsCountStage.PENDING -> "WYNIK CZEKA NA BIURO"
            else -> "PRZELICZENIE ZATWIERDZONE"
        }
        Text(prompt, Modifier.fillMaxWidth().background(Amber, RoundedCornerShape(10.dp)).padding(12.dp), color = Ink, fontWeight = FontWeight.ExtraBold, fontSize = 20.sp)
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
            MiniaturaTowaru(graph, task.tw_id, 96.dp, powieksz = !view.busy, contentScale = ContentScale.Fit)
            Column(Modifier.weight(1f)) { Text(task.sku, fontSize = 22.sp, fontWeight = FontWeight.Bold); Text(task.name); Text(task.bin, color = InkMute) }
        }
        Text(task.recount_reason ?: task.reason)
        if (stage == WmsCountStage.QUANTITY && allowed) {
            Text("Policz sprawne sztuki na tej półce. Nie doliczaj skrzynek ani innych półek. Pusta półka: wpisz 0.")
            Text("Uszkodzenia pozostaw oddzielnie do wyjaśnienia z biurem. Nie przenoś zapasu podczas liczenia.", color = InkMute)
            WertisTextField(quantity, { quantity = it }, placeholder = "Rzeczywista ilość", keyboardType = KeyboardType.Number, onDone = ::confirm)
            PrimaryButton("WYŚLIJ WYNIK DO BIURA", modifier = Modifier.fillMaxWidth(), onClick = ::confirm)
        }
        if (stage == WmsCountStage.PENDING) Text("Wynik zapisany. Półka pozostaje zablokowana. Możesz wybrać kolejne zadanie.")
        (error ?: view.message)?.let { Text(it, fontWeight = FontWeight.Bold) }
        OutlineButton("ODŚWIEŻ I POLICZ PONOWNIE", enabled = allowed, modifier = Modifier.fillMaxWidth()) { graph.appScope.launch { controller.open(context) } }
        OutlineButton("WRÓĆ DO KOLEJKI", enabled = allowed, modifier = Modifier.fillMaxWidth()) { graph.appScope.launch { controller.queue(context) } }
    }
}

