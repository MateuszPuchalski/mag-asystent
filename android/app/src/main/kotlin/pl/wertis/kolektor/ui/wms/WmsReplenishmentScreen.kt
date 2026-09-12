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
import pl.wertis.kolektor.core.wms.WmsReplenishmentDraft
import pl.wertis.kolektor.core.wms.WmsReplenishmentScan
import pl.wertis.kolektor.core.wms.WmsReplenishmentStage
import pl.wertis.kolektor.core.wms.replenishmentFinish
import pl.wertis.kolektor.core.wms.replenishmentCancel
import pl.wertis.kolektor.core.wms.replenishmentClaim
import pl.wertis.kolektor.core.wms.replenishmentCode
import pl.wertis.kolektor.core.wms.replenishmentQuantity
import pl.wertis.kolektor.core.wms.replenishmentScan
import pl.wertis.kolektor.core.wms.replenishmentSpaceStart
import pl.wertis.kolektor.core.wms.replenishmentSpaceQuantity
import pl.wertis.kolektor.core.wms.replenishmentSpaceTarget
import pl.wertis.kolektor.core.wms.replenishmentSpaceFinish
import pl.wertis.kolektor.core.wms.replenishmentStage
import pl.wertis.kolektor.ui.components.OutlineButton
import pl.wertis.kolektor.ui.components.PrimaryButton
import pl.wertis.kolektor.ui.components.WertisTextField
import pl.wertis.kolektor.ui.product.MiniaturaTowaru
import pl.wertis.kolektor.ui.theme.Amber
import pl.wertis.kolektor.ui.theme.Ink
import pl.wertis.kolektor.ui.theme.InkMute

@Composable
fun WmsReplenishmentScreen(graph: AppGraph) {
    val session by graph.session.state.collectAsStateWithLifecycle()
    val settings by graph.settings.settings.collectAsStateWithLifecycle()
    val context = remember(session, settings.serverUrl) { graph.wmsRepo.context() }
    val controller = graph.wmsRepo.replenishing
    val view by controller.state.collectAsStateWithLifecycle()
    val task = view.task.takeIf { view.context == context }
    var scan by remember(view.generation, context) { mutableStateOf(WmsReplenishmentScan()) }
    var quantity by remember(view.generation, context) { mutableStateOf(task?.quantity?.toString().orEmpty()) }
    var reason by remember(view.generation, context) { mutableStateOf("") }
    var cancel by remember(view.generation, context) { mutableStateOf(false) }
    var error by remember(view.generation, context) { mutableStateOf<String?>(null) }
    var query by remember(view.query, context) { mutableStateOf(view.query) }
    val stage = task?.let { replenishmentStage(it, context?.actorId ?: -1, scan) }
    val allowed = context != null && view.context == context && view.ready && !view.busy && view.journal.pending == null
    WmsLifecycleEffect(graph, context, controller::activateVerification, controller::invalidateVerification, controller::open)

    fun submit(draft: WmsReplenishmentDraft) {
        val bound = context ?: return
        error = null
        graph.appScope.launch {
            controller.submit(bound, draft)
            val result = controller.state.value
            if (result.context == bound && result.ready && result.message == null) graph.feedback.zapis() else graph.feedback.beep(false)
        }
    }
    fun queue(mode: String = view.mode, offset: Int = 0) {
        context?.let { bound -> graph.appScope.launch { controller.queue(bound, mode, query, offset) } }
    }
    fun confirmQuantity() {
        if (!allowed || task == null) return
        try {
            scan = replenishmentQuantity(task, context!!.actorId, scan, quantity, reason)
            error = null
            if (scan.quantity == 0) submit(replenishmentFinish(task, context.actorId, scan, task.target))
        } catch (e: IllegalArgumentException) { error = e.message; graph.feedback.beep(false) }
    }
    WmsScanHandlerEffect { input ->
        if (allowed) try {
            if (task == null) {
                query = if (input.kind == pl.wertis.kolektor.core.scan.ScanKind.LOC) input.code else input.rawCode
                queue()
            } else if (cancel) {
                val code = if (input.kind == pl.wertis.kolektor.core.scan.ScanKind.LOC) input.code else input.rawCode
                submit(replenishmentCancel(task, context!!.actorId, code, reason))
            } else if (stage == WmsReplenishmentStage.SPACE_TARGET) {
                scan = replenishmentSpaceTarget(task, context!!.actorId, scan, replenishmentCode(stage, input))
                error = null; graph.feedback.beep(true)
            } else if (stage == WmsReplenishmentStage.SPACE_RETURN) {
                submit(replenishmentSpaceFinish(task, context!!.actorId, scan, replenishmentCode(stage, input)))
            } else if (stage == WmsReplenishmentStage.TARGET) {
                submit(replenishmentFinish(task, context!!.actorId, scan, replenishmentCode(stage, input)))
            } else {
                scan = replenishmentScan(task, context!!.actorId, scan, replenishmentCode(stage, input))
                error = null; graph.feedback.beep(true)
            }
        } catch (e: IllegalArgumentException) { error = e.message; graph.feedback.beep(false) }
        true
    }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        if (context == null) { Text("Zaloguj się, aby uzupełniać półki."); return@Column }
        if ((!allowed && !view.busy) || (view.busy && task == null)) {
            Text(if (view.busy) "Potwierdzam na serwerze…" else "Uzupełnienie wstrzymane", fontWeight = FontWeight.Bold, fontSize = 22.sp)
            Text(view.message ?: "Odczytuję plan…")
            val pending = view.journal.pending
            if (pending != null) WmsPendingNotice(graph, pending, context, "replenishment", view.busy) { graph.appScope.launch { controller.retry(context) } }
            else {
                PrimaryButton("ODŚWIEŻ", enabled = !view.busy, modifier = Modifier.fillMaxWidth()) { graph.appScope.launch { controller.open(context) } }
                OutlineButton("WRÓĆ DO KOLEJKI", enabled = !view.busy, modifier = Modifier.fillMaxWidth()) { queue() }
            }
            return@Column
        }
        if (task == null) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlineButton("MOJE ZADANIA", enabled = allowed && view.mode != "tasks", modifier = Modifier.weight(1f)) { queue("tasks") }
                OutlineButton("DO UZUPEŁNIENIA", enabled = allowed && view.mode != "plans", modifier = Modifier.weight(1f)) { queue("plans") }
            }
            Text("${view.queue?.total ?: 0} ${if (view.mode == "tasks") "zadań" else "propozycji"}", fontSize = 22.sp, fontWeight = FontWeight.Bold)
            Text("Skanuj źródło, półkę albo część. Podjęcie propozycji zabezpiecza jej zapas.", color = InkMute)
            WertisTextField(query, { query = it.take(120) }, placeholder = "SKU, EAN lub lokalizacja", onDone = { queue() })
            PrimaryButton("SZUKAJ", enabled = allowed, modifier = Modifier.fillMaxWidth()) { queue() }
            view.queue?.tasks?.forEach { row ->
                OutlineButton("${row.sku} · ${row.quantity} szt.\n${row.source} → ${row.target}${if (row.blocked != null) "\nDO WYJAŚNIENIA" else ""}", enabled = allowed, modifier = Modifier.fillMaxWidth()) {
                    graph.appScope.launch { controller.select(context, row.id) }
                }
            }
            if (view.mode == "plans") Text("Najpierw braki zamówień: priorytet, potem termin. Brak obejmuje wszystkie półki SKU.", color = InkMute)
            view.queue?.plans?.forEach { plan ->
                OutlineButton("${plan.purpose}\nPODEJMIJ ${plan.take} × ${plan.sku}\n${plan.source} → ${plan.target}\n${plan.name}", enabled = allowed && plan.take > 0, modifier = Modifier.fillMaxWidth()) { submit(replenishmentClaim(plan)) }
            }
            if (view.queue?.total == 0) Text(if (view.mode == "tasks") "Nie masz otwartych zadań. Sprawdź propozycje do uzupełnienia." else "Brak dostępnych propozycji. Sprawdź filtr, przyjęcia i minima półek.")
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlineButton("POPRZEDNIE", enabled = allowed && view.offset > 0, modifier = Modifier.weight(1f)) { queue(offset = (view.offset - 50).coerceAtLeast(0)) }
                OutlineButton("NASTĘPNE", enabled = allowed && view.offset + 50 < (view.queue?.total ?: 0), modifier = Modifier.weight(1f)) { queue(offset = view.offset + 50) }
            }
            (error ?: view.message)?.let { Text(it, fontWeight = FontWeight.Bold) }
            return@Column
        }
        val prompt = if (view.busy) "ZAPISUJĘ — ZACZEKAJ NA SYGNAŁ" else if (cancel) "ODŁÓŻ SZTUKI I SKANUJ ${task.source}" else when (stage) {
            WmsReplenishmentStage.SOURCE -> "1 · SKANUJ ŹRÓDŁO ${task.source}"
            WmsReplenishmentStage.PRODUCT -> "2 · SKANUJ KOD CZĘŚCI"
            WmsReplenishmentStage.QUANTITY -> "3 · POTWIERDŹ POBRANĄ ILOŚĆ"
            WmsReplenishmentStage.TARGET -> "4 · ODŁÓŻ I SKANUJ ${task.target}"
            WmsReplenishmentStage.SPACE_QUANTITY -> "BRAK MIEJSCA — ILE ODŁOŻONO?"
            WmsReplenishmentStage.SPACE_TARGET -> "POTWIERDŹ CEL ${task.target}"
            WmsReplenishmentStage.SPACE_RETURN -> "ZWRÓĆ RESZTĘ NA ${task.source}"
            WmsReplenishmentStage.DONE -> "ZADANIE ROZLICZONE"
            else -> "ZADANIE DO WYJAŚNIENIA"
        }
        Text(prompt, Modifier.fillMaxWidth().background(Amber, RoundedCornerShape(10.dp)).padding(12.dp), color = Ink, fontWeight = FontWeight.ExtraBold, fontSize = 20.sp)
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
            MiniaturaTowaru(graph, task.tw_id, 96.dp, powieksz = !view.busy, contentScale = ContentScale.Fit)
            Column(Modifier.weight(1f)) { Text(task.sku, fontSize = 22.sp, fontWeight = FontWeight.Bold); Text(task.name); Text("${task.source} → ${task.target}", color = InkMute) }
        }
        Text("Przydział: ${task.quantity} szt.", fontSize = 20.sp, fontWeight = FontWeight.Bold)
        if (cancel) {
            Text("Odłóż wszystkie pobrane, niepotwierdzone sztuki na źródło. Anulowanie nie przesuwa zapasu.")
            WertisTextField(reason, { reason = it.take(500) }, placeholder = "Powód anulowania")
            Text("Po wpisaniu powodu skan źródła zapisze anulowanie.")
        } else when (stage) {
            WmsReplenishmentStage.QUANTITY -> if (allowed) {
                WertisTextField(quantity, { quantity = it.take(7) }, placeholder = "Faktycznie pobrane sztuki", keyboardType = KeyboardType.Number, onDone = ::confirmQuantity)
                if ((quantity.toIntOrNull() ?: task.quantity) < task.quantity) {
                    Text("Zgłaszasz brak. Źródło pozostanie do przeliczenia. Nie koryguj jego stanu ręcznie.")
                    WertisTextField(reason, { reason = it.take(500) }, placeholder = "Opis brakujących sztuk")
                }
                PrimaryButton(if (quantity.toIntOrNull() == 0) "ZGŁOŚ PUSTE ŹRÓDŁO" else "POTWIERDŹ ILOŚĆ", modifier = Modifier.fillMaxWidth(), onClick = ::confirmQuantity)
            }
            WmsReplenishmentStage.TARGET -> Text("${scan.quantity} szt. → ${task.target}. Skan celu zapisze przesunięcie.", fontSize = 22.sp, fontWeight = FontWeight.Bold)
            WmsReplenishmentStage.SPACE_QUANTITY -> if (allowed) {
                Text("Pobrano ${scan.quantity} szt. Wpisz, ile faktycznie mieści się na celu. Pozostałe sztuki wrócą na źródło.")
                WertisTextField(quantity, { quantity = it.take(7) }, placeholder = "Odłożone sztuki, także 0", keyboardType = KeyboardType.Number)
                WertisTextField(reason, { reason = it.take(500) }, placeholder = "Opis braku miejsca")
                PrimaryButton("POTWIERDŹ ODŁOŻONĄ ILOŚĆ", modifier = Modifier.fillMaxWidth()) {
                    try { scan = replenishmentSpaceQuantity(task, context.actorId, scan, quantity, reason); error = null }
                    catch (e: IllegalArgumentException) { error = e.message; graph.feedback.beep(false) }
                }
            }
            WmsReplenishmentStage.SPACE_TARGET -> Text("${scan.placed} szt. na ${task.target}. Skan potwierdza cel; zapas rozliczy się po zwrocie reszty.")
            WmsReplenishmentStage.SPACE_RETURN -> Text("Zwróć ${(scan.quantity ?: 0) - (scan.placed ?: 0)} szt. na ${task.source} i zeskanuj źródło. Cel pozostanie zamknięty dla dokładania do decyzji biura.")
            WmsReplenishmentStage.BLOCKED -> Text(task.blocked.orEmpty())
            WmsReplenishmentStage.OTHER -> Text("Zadanie wykonuje inna osoba. Przekaż jej towar i wróć do kolejki.")
            WmsReplenishmentStage.DONE -> Text(if (task.cancelled_at != null) "Anulowano bez przesunięcia zapasu." else "Przesunięto ${task.moved ?: task.quantity} szt.${if (task.target_full == 1) " Zwrócono ${task.returned_quantity} szt. Cel czeka na zwolnienie miejsca." else ""}${if ((task.moved ?: task.quantity) + task.returned_quantity < task.quantity) " Źródło czeka na przeliczenie." else ""}")
            else -> Text("Po przerwie zbierz wszystkie niepotwierdzone sztuki z celu i wózka na źródło, zanim zaczniesz ponownie.", color = InkMute)
        }
        (error ?: view.message)?.let { Text(it, fontWeight = FontWeight.Bold) }
        if (stage !in setOf(WmsReplenishmentStage.DONE, WmsReplenishmentStage.OTHER)) {
            OutlineButton(if (cancel) "WRÓĆ DO UZUPEŁNIANIA" else "PROBLEM / ANULOWANIE", enabled = allowed, modifier = Modifier.fillMaxWidth()) { cancel = !cancel; scan = WmsReplenishmentScan(); reason = "" }
            if (!cancel && stage == WmsReplenishmentStage.TARGET) OutlineButton("BRAK MIEJSCA NA CELU", enabled = allowed, modifier = Modifier.fillMaxWidth()) {
                scan = replenishmentSpaceStart(task, context.actorId, scan); quantity = ""; reason = ""; error = null
            }
            if (!cancel && stage == WmsReplenishmentStage.TARGET) OutlineButton("ZMIENIAM ILOŚĆ", enabled = allowed, modifier = Modifier.fillMaxWidth()) { scan = scan.copy(quantity = null) }
        }
        OutlineButton("WRÓĆ DO KOLEJKI", enabled = allowed, modifier = Modifier.fillMaxWidth()) { queue() }
    }
}

