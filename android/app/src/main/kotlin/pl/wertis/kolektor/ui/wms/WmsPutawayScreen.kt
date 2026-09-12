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
import pl.wertis.kolektor.core.wms.WmsPutawayDraft
import pl.wertis.kolektor.core.wms.WmsPutawayScan
import pl.wertis.kolektor.core.wms.WmsPutawayStage
import pl.wertis.kolektor.core.wms.putawayClaim
import pl.wertis.kolektor.core.wms.putawayCode
import pl.wertis.kolektor.core.wms.putawayQuantity
import pl.wertis.kolektor.core.wms.putawayScan
import pl.wertis.kolektor.core.wms.putawayStage
import pl.wertis.kolektor.ui.components.OutlineButton
import pl.wertis.kolektor.ui.components.PrimaryButton
import pl.wertis.kolektor.ui.components.WertisTextField
import pl.wertis.kolektor.ui.product.MiniaturaTowaru
import pl.wertis.kolektor.ui.theme.Amber
import pl.wertis.kolektor.ui.theme.Ink
import pl.wertis.kolektor.ui.theme.InkMute

@Composable
fun WmsPutawayScreen(graph: AppGraph) {
    val session by graph.session.state.collectAsStateWithLifecycle()
    val settings by graph.settings.settings.collectAsStateWithLifecycle()
    val context = remember(session, settings.serverUrl) { graph.wmsRepo.context() }
    val controller = graph.wmsRepo.putaway
    val view by controller.state.collectAsStateWithLifecycle()
    val task = view.task.takeIf { view.context == context }
    var scan by remember(view.generation, context) { mutableStateOf(WmsPutawayScan()) }
    var quantity by remember(view.generation, context) { mutableStateOf(task?.remaining?.toString().orEmpty()) }
    var error by remember(view.generation, context) { mutableStateOf<String?>(null) }
    var damaged by remember(view.generation, context) { mutableStateOf(false) }
    var options by remember(view.generation, context) { mutableStateOf(false) }
    var query by remember(view.query, context) { mutableStateOf(view.query) }
    val stage = task?.let { putawayStage(it, context?.actorId ?: -1, scan) }
    val allowed = view.context == context && context != null && view.ready && !view.busy && view.journal.pending == null

    WmsLifecycleEffect(graph, context, controller::activateVerification, controller::invalidateVerification, controller::open)

    fun submit(draft: WmsPutawayDraft) {
        val bound = context ?: return
        error = null
        graph.appScope.launch {
            controller.submit(bound, draft)
            val result = controller.state.value
            if (result.context == bound && result.ready && result.message == null) graph.feedback.zapis()
            else graph.feedback.beep(false)
        }
    }
    fun search() {
        val bound = context ?: return
        graph.appScope.launch { controller.queue(bound, query.trim()) }
    }
    fun confirmQuantity() {
        val current = task ?: return
        if (!allowed) return
        val result = putawayQuantity(current, scan, quantity)
        scan = result.state
        error = result.error
        graph.feedback.beep(result.error == null)
    }

    WmsScanHandlerEffect { input ->
        // Żaden skan przy błędzie lub zapisie nie może trafić do globalnego szukania.
        if (!allowed || controller.state.value.busy || view.generation != controller.state.value.generation) {
            error = "Najpierw potwierdź stan ostatniej operacji"
            graph.feedback.beep(false)
        } else if (task == null) {
            query = input.rawCode.trim()
            search()
        } else {
            val result = putawayScan(task, context!!.actorId, scan, putawayCode(stage!!, input), damaged)
            scan = result.state
            error = result.error
            result.command?.let(::submit) ?: graph.feedback.beep(result.error == null)
        }
        true
    }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        if (context == null) {
            Text("Zaloguj się, aby odkładać towar z bufora.")
            return@Column
        }
        val pending = view.journal.pending
        if ((!allowed && !view.busy) || (view.busy && task == null)) {
            Text(if (view.busy) "Potwierdzam na serwerze…" else "Odkładanie wstrzymane", fontWeight = FontWeight.Bold, fontSize = 22.sp)
            Text(view.message ?: "Odczytuję zadania…")
            if (pending != null) {
                WmsPendingNotice(graph, pending, context, "putaway", view.busy) {
                    graph.appScope.launch { controller.retry(context) }
                }
            } else {
                PrimaryButton("ODŚWIEŻ", enabled = !view.busy, modifier = Modifier.fillMaxWidth()) {
                    graph.appScope.launch { controller.open(context) }
                }
                OutlineButton("WRÓĆ DO KOLEJKI", enabled = !view.busy, modifier = Modifier.fillMaxWidth()) {
                    graph.appScope.launch { controller.queue(context) }
                }
            }
            return@Column
        }

        if (task == null) {
            val queue = view.queue
            Text("${queue?.totals?.tasks ?: 0} zadań · ${queue?.totals?.units ?: 0} szt.", fontWeight = FontWeight.Bold, fontSize = 22.sp)
            Text("Skanuj kod części lub bufora. Wybierz zadanie do odłożenia.", color = InkMute)
            WertisTextField(query, { query = it.take(120) }, placeholder = "SKU, EAN, bufor lub dokument", onDone = ::search)
            PrimaryButton("SZUKAJ", enabled = allowed, modifier = Modifier.fillMaxWidth(), onClick = ::search)
            if (queue?.rows?.isEmpty() == true) Text("Brak otwartych zadań dla tego filtra.")
            queue?.rows?.forEach { row ->
                OutlineButton("${row.source} · ${row.sku} · ${row.remaining} szt.\n${row.name}\n${row.reference} · ${if (row.user_id == context.actorId) "Twoje" else if (row.user_id == null) "Wolne" else "W trakcie u innej osoby"}", enabled = allowed, modifier = Modifier.fillMaxWidth()) {
                    graph.appScope.launch { controller.select(context, row.id) }
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlineButton("POPRZEDNIE", enabled = allowed && view.offset > 0, modifier = Modifier.weight(1f)) {
                    graph.appScope.launch { controller.queue(context, view.query, (view.offset - 50).coerceAtLeast(0)) }
                }
                OutlineButton("NASTĘPNE", enabled = allowed && view.offset + 50 < (queue?.totals?.tasks ?: 0), modifier = Modifier.weight(1f)) {
                    graph.appScope.launch { controller.queue(context, view.query, view.offset + 50) }
                }
            }
            return@Column
        }

        val prompt = if (view.busy) "ZAPISUJĘ — ZACZEKAJ NA SYGNAŁ" else when (stage) {
            WmsPutawayStage.CLAIM -> "PODEJMIJ ZADANIE"
            WmsPutawayStage.SOURCE -> "1 · SKANUJ BUFOR ${task.source}"
            WmsPutawayStage.PRODUCT -> "2 · SKANUJ KOD CZĘŚCI"
            WmsPutawayStage.QUANTITY -> "3 · POLICZ I POTWIERDŹ ILOŚĆ"
            WmsPutawayStage.TARGET -> if (damaged) "4 · SKANUJ KWARANTANNĘ" else "4 · ODŁÓŻ I SKANUJ PÓŁKĘ"
            WmsPutawayStage.DONE -> "ZADANIE ZAKOŃCZONE"
            else -> "ZADANIE WYKONUJE INNA OSOBA"
        }
        Text(prompt, Modifier.fillMaxWidth().background(Amber, RoundedCornerShape(10.dp)).padding(12.dp), color = Ink, fontWeight = FontWeight.ExtraBold, fontSize = 20.sp)
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
            MiniaturaTowaru(graph, task.tw_id, 96.dp, powieksz = !view.busy, contentScale = ContentScale.Fit)
            Column(Modifier.weight(1f)) {
                Text(task.sku, fontWeight = FontWeight.ExtraBold, fontSize = 22.sp)
                Text(task.name, fontSize = 16.sp)
                Text("${task.source} · ${task.reference}", color = InkMute, fontSize = 14.sp)
            }
        }
        Text("Pozostało w buforze: ${task.remaining} szt.", fontWeight = FontWeight.Bold, fontSize = 20.sp)
        when (stage) {
            WmsPutawayStage.CLAIM -> PrimaryButton("PODEJMIJ ODKŁADANIE", enabled = allowed, modifier = Modifier.fillMaxWidth()) {
                submit(putawayClaim(task))
            }
            WmsPutawayStage.QUANTITY -> if (allowed) {
                Text("Ile sztuk odkładasz teraz?")
                WertisTextField(quantity, { quantity = it.take(7) }, placeholder = "Ilość sztuk", keyboardType = KeyboardType.Number, onDone = ::confirmQuantity)
                PrimaryButton("POTWIERDŹ ILOŚĆ", modifier = Modifier.fillMaxWidth(), onClick = ::confirmQuantity)
            }
            WmsPutawayStage.TARGET -> {
                Text("${scan.quantity} szt. → ${if (damaged) "KWARANTANNA" else "PÓŁKA"}", fontSize = 26.sp, fontWeight = FontWeight.ExtraBold)
                if (!damaged && task.bins.isNotEmpty()) Text("Znane półki: ${task.bins.joinToString { it.bin }}", color = InkMute)
                Text("Skan celu zapisze tę ilość. Częściowe odłożenie pozostawi resztę w buforze.")
            }
            WmsPutawayStage.OTHER -> Text("Przekaż towar właścicielowi zadania lub poproś biuro o przejęcie.")
            WmsPutawayStage.DONE -> Text("Cała ilość została rozliczona. Wybierz kolejne zadanie.")
            else -> Unit
        }
        (error ?: view.message)?.let { Text(it, fontWeight = FontWeight.Bold) }
        if (stage !in setOf(WmsPutawayStage.DONE, WmsPutawayStage.OTHER, WmsPutawayStage.CLAIM)) {
            OutlineButton(if (options) "ZAMKNIJ OPCJE" else "PROBLEM / ZMIEŃ ILOŚĆ", enabled = allowed, modifier = Modifier.fillMaxWidth()) { options = !options }
            if (options && allowed) {
                OutlineButton(if (damaged) "DOBRY TOWAR NA PÓŁKĘ" else "USZKODZONY TOWAR DO KWARANTANNY", modifier = Modifier.fillMaxWidth()) {
                    damaged = !damaged
                    scan = scan.copy(quantity = null)
                    options = false
                }
                OutlineButton("ZMIENIAM ILOŚĆ", modifier = Modifier.fillMaxWidth()) { scan = scan.copy(quantity = null); options = false }
                Text("Brak sztuk? Pozostaw nieodłożoną ilość i zgłoś biuru korektę tego zadania.")
                OutlineButton("ODŚWIEŻ ZADANIE", modifier = Modifier.fillMaxWidth()) {
                    graph.appScope.launch { controller.open(context) }
                }
            }
        }
        OutlineButton("WRÓĆ DO KOLEJKI", enabled = allowed, modifier = Modifier.fillMaxWidth()) {
            graph.appScope.launch { controller.queue(context) }
        }
    }
}
