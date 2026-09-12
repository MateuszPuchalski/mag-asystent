package pl.wertis.kolektor.ui.wms

import androidx.compose.foundation.background
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
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import kotlinx.coroutines.launch
import pl.wertis.kolektor.AppGraph
import pl.wertis.kolektor.core.wms.WmsDraft
import pl.wertis.kolektor.core.wms.WmsScanState
import pl.wertis.kolektor.core.wms.WmsStage
import pl.wertis.kolektor.core.wms.wmsException
import pl.wertis.kolektor.core.wms.wmsScan
import pl.wertis.kolektor.core.wms.wmsScanCode
import pl.wertis.kolektor.core.wms.wmsStage
import pl.wertis.kolektor.scan.ScanHandlerEffect
import pl.wertis.kolektor.scan.WedgeKeySource
import pl.wertis.kolektor.ui.components.OutlineButton
import pl.wertis.kolektor.ui.components.PrimaryButton
import pl.wertis.kolektor.ui.product.MiniaturaTowaru
import pl.wertis.kolektor.ui.theme.Amber
import pl.wertis.kolektor.ui.theme.Ink
import pl.wertis.kolektor.ui.theme.InkMute

@Composable
fun WmsPickingScreen(graph: AppGraph) {
    val session by graph.session.state.collectAsStateWithLifecycle()
    val settings by graph.settings.settings.collectAsStateWithLifecycle()
    val context = remember(session, settings.serverUrl) { graph.wmsRepo.context() }
    val controller = graph.wmsRepo.controller
    val view by controller.state.collectAsStateWithLifecycle()
    val run = view.run.takeIf { view.context == context }
    val task = context?.let { run?.nextTask(it.actorId) }
    // Powrót na ekran zawsze odczytuje trasę. Weryfikacja półki i części nie
    // przeżywa przerwy, zmiany konta ani odświeżenia przez biuro.
    var scan by remember(view.generation, context) { mutableStateOf(view.initialScan ?: WmsScanState(quantity = task?.remaining ?: 1)) }
    var error by remember(view.generation, context) { mutableStateOf<String?>(null) }
    var exception by remember(view.generation, context) { mutableStateOf<String?>(null) }
    var tools by remember(view.generation, context) { mutableStateOf(false) }
    val stage = wmsStage(run, context?.actorId ?: -1, scan)
    val allowed = view.context == context && view.ready && !view.busy && view.journal.pending == null && context != null

    LaunchedEffect(context) { context?.let { controller.open(it) } }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    DisposableEffect(lifecycle, context) {
        var paused = false
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_PAUSE) {
                paused = true
                controller.invalidateVerification()
            } else if (event == Lifecycle.Event.ON_RESUME && paused) {
                paused = false
                context?.let { bound -> graph.appScope.launch { controller.open(bound) } }
            }
        }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer); controller.invalidateVerification() }
    }
    DisposableEffect(Unit) {
        WedgeKeySource.wmsMode(true)
        onDispose { WedgeKeySource.wmsMode(false) }
    }

    fun submit(draft: WmsDraft) {
        val bound = context ?: return
        error = null
        graph.appScope.launch {
            controller.submit(bound, draft)
            val result = controller.state.value
            if (result.context == bound && result.ready && result.message == null) graph.feedback.zapis()
            else graph.feedback.beep(false)
        }
    }

    ScanHandlerEffect { input ->
        // Handler bierze KAŻDY skan, także przy błędzie i zapisie. Nie pozwala
        // przejść do globalnego wyszukiwania produktu w środku zbiórki.
        if (!allowed || controller.state.value.busy || view.generation != controller.state.value.generation) {
            graph.feedback.beep(false)
            error = "Najpierw potwierdź wynik ostatniej operacji"
        } else if (exception != null && task != null && run != null) {
            val kind = exception!!
            val reason = when (kind) {
                "missing" -> "Brak towaru na wskazanej półce"
                "damaged" -> "Towar na półce jest uszkodzony"
                else -> "Brak miejsca w przypisanej skrzynce"
            }
            try { submit(wmsException(run, task, input.rawCode.trim(), kind, reason)) }
            catch (e: IllegalArgumentException) { error = e.message; graph.feedback.beep(false) }
        } else {
            val result = wmsScan(run, context!!.actorId, scan, wmsScanCode(stage, input))
            error = result.error
            scan = result.state
            result.command?.let(::submit) ?: graph.feedback.beep(result.error == null)
        }
        true
    }

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        if (context == null) {
            Text("Zaloguj się na swoje konto, aby rozpocząć zbiórkę.")
            return@Column
        }
        val pending = view.journal.pending
        if ((!allowed && !view.busy) || run == null && view.busy) {
            Text(if (view.busy) "Potwierdzam na serwerze…" else "Zbiórka wstrzymana", fontWeight = FontWeight.Bold, fontSize = 22.sp)
            Text(view.message ?: "Odczytuję trasę…")
            if (pending != null) {
                Text(pending.description, fontWeight = FontWeight.Bold)
                Text("Nie odkładaj kolejnej sztuki. Ponowienie sprawdzi ten sam zapis.")
                PrimaryButton("SPRAWDŹ OSTATNI ZAPIS", enabled = !view.busy && pending.context == context, modifier = Modifier.fillMaxWidth()) {
                    graph.appScope.launch { controller.retry(context) }
                }
            } else {
                PrimaryButton("ODŚWIEŻ TRASĘ", enabled = !view.busy, modifier = Modifier.fillMaxWidth()) {
                    graph.appScope.launch { controller.open(context) }
                }
            }
            return@Column
        }

        if (run != null) {
            Text("${run.cart_code} · ${run.orders.count { it.status == "picked" }}/${run.orders.size} zebranych", color = InkMute, fontSize = 14.sp)
        }
        val prompt = if (view.busy) "ZAPISUJĘ — ZACZEKAJ NA SYGNAŁ" else if (exception != null) "ZGŁOSZENIE — SKANUJ SKRZYNKĘ" else when (stage) {
            WmsStage.CART -> "SKANUJ KOD WÓZKA"
            WmsStage.LOCATION -> "1 · SKANUJ LOKALIZACJĘ"
            WmsStage.PRODUCT -> "2 · SKANUJ TOWAR"
            WmsStage.BOX -> "3 · ODŁÓŻ I SKANUJ SKRZYNKĘ"
            WmsStage.HANDOFF_CART -> "ZBIÓRKA GOTOWA · SKANUJ WÓZEK"
            WmsStage.STATION -> "SKANUJ STANOWISKO PAKOWANIA"
            WmsStage.DONE -> "WÓZEK PRZEKAZANY"
            WmsStage.WAIT -> "TRASA WSTRZYMANA"
        }
        Text(prompt, fontWeight = FontWeight.ExtraBold, fontSize = 18.sp, color = Ink,
            modifier = Modifier.fillMaxWidth().background(Amber, RoundedCornerShape(10.dp)).padding(12.dp))

        if (task != null && stage !in setOf(WmsStage.DONE, WmsStage.WAIT)) {
            Text(task.bin, fontSize = 32.sp, fontWeight = FontWeight.ExtraBold, color = Ink)
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                MiniaturaTowaru(graph, task.tw_id, 124.dp, powieksz = true, contentScale = ContentScale.Fit,
                    zamiast = {
                        Box(Modifier.size(124.dp).background(Amber.copy(alpha = 0.12f)), contentAlignment = Alignment.Center) {
                            Text("Brak podglądu\nSprawdź SKU i kod", fontSize = 13.sp, modifier = Modifier.padding(8.dp))
                        }
                    })
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(task.sku, fontWeight = FontWeight.ExtraBold, fontSize = 20.sp)
                    Text(task.name, fontSize = 16.sp)
                    Text("Łącznie tutaj: ${task.stop_quantity} szt.", fontSize = 14.sp, color = InkMute)
                }
            }
            Text("POZYCJA ${task.position}  ·  ${task.tote}", fontWeight = FontWeight.ExtraBold, fontSize = 22.sp)
            if (view.initialScan != null && !view.busy) Text("Ta sama półka i część — skanuj kolejną skrzynkę", fontSize = 14.sp)
            if (exception == null) {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                    OutlineButton("−", modifier = Modifier.size(52.dp), enabled = allowed && scan.quantity > 1) { scan = scan.copy(quantity = scan.quantity - 1) }
                    Text("${scan.quantity} szt.", modifier = Modifier.weight(1f), fontWeight = FontWeight.ExtraBold, fontSize = 30.sp)
                    OutlineButton("+", modifier = Modifier.size(52.dp), enabled = allowed && scan.quantity < task.remaining) { scan = scan.copy(quantity = scan.quantity + 1) }
                }
                Text("Do tej skrzynki: ${task.remaining} szt. Skan skrzynki zapisze pokazaną ilość.", fontSize = 14.sp)
            } else {
                Text("Nie pobieraj kolejnej sztuki. Zgłoszenie zatrzyma zamówienie do sprawdzenia przez biuro.")
                OutlineButton("ANULUJ ZGŁOSZENIE", enabled = allowed, modifier = Modifier.fillMaxWidth()) { exception = null }
            }
        } else when (stage) {
            WmsStage.CART -> Text("Wózek dobierze zamówienia do wolnych skrzynek. Każda skrzynka zachowuje swoją pozycję.")
            WmsStage.HANDOFF_CART, WmsStage.STATION -> Text("Dostarcz ${run?.cart_code} do pakujących. Zeskanuj wózek, następnie stanowisko.")
            WmsStage.DONE -> PrimaryButton("KOLEJNY WÓZEK", enabled = allowed, modifier = Modifier.fillMaxWidth()) {
                graph.appScope.launch { controller.nextCart(context) }
            }
            WmsStage.WAIT -> Text("Brak bezpiecznej pozycji do zebrania. Odśwież trasę; jeśli blokada pozostaje, skontaktuj się z biurem.")
            else -> Unit
        }

        (error ?: view.message)?.let { Text(it, fontWeight = FontWeight.Bold, color = Ink) }
        if (run != null && stage != WmsStage.DONE) {
            OutlineButton(if (tools) "ZAMKNIJ OPCJE" else "PROBLEM / ODŚWIEŻ", enabled = allowed, modifier = Modifier.fillMaxWidth()) { tools = !tools }
            if (tools && allowed) {
                OutlineButton("SPRAWDŹ PÓŁKĘ I TOWAR PONOWNIE", modifier = Modifier.fillMaxWidth()) { controller.invalidateVerification() }
                if (task != null && scan.location && exception == null) {
                    listOf("missing" to "BRAK TOWARU", "damaged" to "USZKODZONY TOWAR", "box_full" to "PEŁNA SKRZYNKA").forEach { (kind, label) ->
                        OutlineButton(label, modifier = Modifier.fillMaxWidth()) { exception = kind; tools = false }
                    }
                }
                if (task != null && !scan.location) Text("Aby zgłosić problem, najpierw zeskanuj właściwą lokalizację.")
                OutlineButton("ODŚWIEŻ TRASĘ", modifier = Modifier.fillMaxWidth()) {
                    graph.appScope.launch { controller.open(context) }
                }
            }
        }
    }
}
