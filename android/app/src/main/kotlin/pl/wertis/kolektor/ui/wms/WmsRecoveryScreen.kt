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
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.launch
import pl.wertis.kolektor.AppGraph
import pl.wertis.kolektor.core.scan.ScanKind
import pl.wertis.kolektor.core.wms.WmsRecoveryDraft
import pl.wertis.kolektor.core.wms.WmsRecoveryScan
import pl.wertis.kolektor.core.wms.WmsRecoveryStage
import pl.wertis.kolektor.core.wms.recoveryClaim
import pl.wertis.kolektor.core.wms.recoveryFinish
import pl.wertis.kolektor.core.wms.recoveryPick
import pl.wertis.kolektor.core.wms.recoveryQuantity
import pl.wertis.kolektor.core.wms.recoveryRelease
import pl.wertis.kolektor.core.wms.recoveryScan
import pl.wertis.kolektor.core.wms.recoveryStage
import pl.wertis.kolektor.ui.components.OutlineButton
import pl.wertis.kolektor.ui.components.PrimaryButton
import pl.wertis.kolektor.ui.components.WertisTextField
import pl.wertis.kolektor.ui.product.MiniaturaTowaru
import pl.wertis.kolektor.ui.theme.Amber
import pl.wertis.kolektor.ui.theme.Ink
import pl.wertis.kolektor.ui.theme.InkMute

@Composable
fun WmsRecoveryScreen(graph: AppGraph) {
    val session by graph.session.state.collectAsStateWithLifecycle()
    val settings by graph.settings.settings.collectAsStateWithLifecycle()
    val context = remember(session, settings.serverUrl) { graph.wmsRepo.context() }
    val controller = graph.wmsRepo.recovering
    val view by controller.state.collectAsStateWithLifecycle()
    val task = view.task.takeIf { view.context == context }
    var scan by remember(view.generation, context) { mutableStateOf(WmsRecoveryScan()) }
    var quantity by remember(view.generation, context) { mutableStateOf("") }
    var releasing by remember(view.generation, context) { mutableStateOf(false) }
    var returned by remember(view.generation, context) { mutableStateOf(emptySet<String>()) }
    var reason by remember(view.generation, context) { mutableStateOf("") }
    var error by remember(view.generation, context) { mutableStateOf<String?>(null) }
    var query by remember(view.query, context) { mutableStateOf(view.query) }
    val stage = task?.let { recoveryStage(it, context?.actorId ?: -1, scan) }
    val pick = task?.let { recoveryPick(it, scan) }
    val allowed = context != null && view.context == context && view.ready && !view.busy && view.journal.pending == null
    WmsLifecycleEffect(graph, context, controller::activateVerification, controller::invalidateVerification, controller::open)
    fun submit(draft: WmsRecoveryDraft) {
        val bound=context ?: return
        error=null
        graph.appScope.launch { controller.submit(bound,draft)
            if(controller.state.value.ready && controller.state.value.message==null)graph.feedback.zapis() else graph.feedback.beep(false) }
    }
    fun queue(offset:Int=0) { context?.let { bound -> graph.appScope.launch { controller.queue(bound,query=query,offset=offset) } } }
    fun confirm() {
        if(!allowed || task==null)return
        try { scan=recoveryQuantity(task,context!!.actorId,scan,quantity);error=null }
        catch(e:IllegalArgumentException){error=e.message;graph.feedback.beep(false)}
    }
    WmsScanHandlerEffect { input ->
        if(allowed)try {
            if(task==null){query=if(input.kind==ScanKind.LOC)input.code else input.rawCode;queue()}
            else if(releasing){
                val code=(if(input.kind==ScanKind.LOC)input.code else input.rawCode).trim().uppercase()
                require(code in task.picks.map { it.bin }) { "To nie jest źródło oczekującego pobrania" }
                returned=returned+code;error=null;graph.feedback.beep(true)
            } else if(stage==WmsRecoveryStage.BOX)submit(recoveryFinish(task,context!!.actorId,scan,input))
            else {scan=recoveryScan(task,context!!.actorId,scan,input);error=null;graph.feedback.beep(true)}
        }catch(e:IllegalArgumentException){error=e.message;graph.feedback.beep(false)}
        // Skan na wstrzymanym ekranie też jest obsłużony, aby nie otwierał globalnej kartoteki.
        true
    }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),verticalArrangement=Arrangement.spacedBy(12.dp)) {
        if(context==null){Text("Zaloguj się ponownie.");return@Column}
        if(view.context!=context || view.busy || !view.ready){
            Text(if(view.busy)"Potwierdzam na serwerze…" else "Wymiana wstrzymana",fontSize=22.sp,fontWeight=FontWeight.Bold)
            Text(view.message ?: "Czekam na świeży stan zadania.")
            view.journal.pending?.let { pending ->
                WmsPendingNotice(graph,pending,context,"pack-recovery",view.busy) { graph.appScope.launch { controller.retry(context) } }
            }
            OutlineButton("SPRAWDŹ STAN",enabled=!view.busy,modifier=Modifier.fillMaxWidth()){graph.appScope.launch{controller.open(context)}}
            return@Column
        }
        if(task==null){
            Text("${view.queue?.total ?: 0} wymian do pakowania",fontSize=22.sp,fontWeight=FontWeight.Bold)
            WertisTextField(query,{query=it.take(120)},placeholder="Zamówienie lub skrzynka",onDone={queue()})
            PrimaryButton("SZUKAJ",enabled=allowed,modifier=Modifier.fillMaxWidth()){queue()}
            view.queue?.rows?.forEach { row -> OutlineButton("${row.reference} · ${row.remaining} szt.\nSkrzynka ${row.box ?: "—"}${if(row.user_id!=null)" · podjęta" else ""}",enabled=allowed,modifier=Modifier.fillMaxWidth()) {graph.appScope.launch{controller.select(context,row.id)}} }
            if(view.queue?.total==0)Text("Nie ma oczekujących wymian. Dobre sztuki pozostają przy pakowaniu.")
            Row(horizontalArrangement=Arrangement.spacedBy(10.dp)) {
                OutlineButton("POPRZEDNIE",enabled=allowed && view.offset>0,modifier=Modifier.weight(1f)){queue((view.offset-50).coerceAtLeast(0))}
                OutlineButton("NASTĘPNE",enabled=allowed && view.offset+50<(view.queue?.total?:0),modifier=Modifier.weight(1f)){queue(view.offset+50)}
            }
            return@Column
        }
        Text(task.reference,fontSize=22.sp,fontWeight=FontWeight.Bold)
        Text("Skrzynka: ${task.box ?: "—"}",fontSize=22.sp,fontWeight=FontWeight.Bold)
        val prompt=if(releasing)"ZWRÓĆ NIEPOTWIERDZONE SZTUKI" else when(stage){
            WmsRecoveryStage.AVAILABLE -> "PODEJMIJ WYMIANĘ"
            WmsRecoveryStage.SOURCE -> "1 · SKANUJ ${pick?.bin}"
            WmsRecoveryStage.PRODUCT -> "2 · SKANUJ CZĘŚĆ"
            WmsRecoveryStage.QUANTITY -> "3 · POTWIERDŹ ILOŚĆ"
            WmsRecoveryStage.BOX -> "4 · DOSTARCZ DO ${task.box}"
            WmsRecoveryStage.DONE -> "WYMIANA ROZLICZONA"
            else -> "WYMIANA DO WYJAŚNIENIA"
        }
        Text(prompt,Modifier.fillMaxWidth().background(Amber,RoundedCornerShape(10.dp)).padding(12.dp),color=Ink,fontWeight=FontWeight.ExtraBold,fontSize=20.sp)
        if(stage==WmsRecoveryStage.AVAILABLE){
            task.lines.filter{it.replaced<it.quantity}.forEach{Text("${it.sku} · ${it.quantity-it.replaced} szt.")}
            Text("Podjęcie rezerwuje tylko brakujące zamienniki. Brak zapasu nie cofa kwarantanny.")
            PrimaryButton("PODEJMIJ WYMIANĘ",enabled=allowed,modifier=Modifier.fillMaxWidth()){submit(recoveryClaim(task,context.actorId))}
        } else if(releasing){
            Text("Potwierdzone zamienniki zostają przy pakowaniu. Zwróć pozostałe pobrane sztuki na każde źródło i zeskanuj je.")
            task.picks.map{it.bin}.distinct().forEach{Text("${if(it in returned)"✓" else "○"} $it")}
            WertisTextField(reason,{reason=it.take(500)},placeholder="Powód zwolnienia")
            PrimaryButton("ZWOLNIJ WYMIANĘ",enabled=allowed && returned==task.picks.map{it.bin}.toSet() && reason.trim().length>=3,modifier=Modifier.fillMaxWidth()) {submit(recoveryRelease(task,context.actorId,returned,reason))}
        } else if(stage==WmsRecoveryStage.DONE){Text(if(task.completed_at!=null)"Zamienniki dostarczone. Pakujący musi je jeszcze sprawdzić." else "Wymiana przerwana w biurze.")}
        else if(stage==WmsRecoveryStage.OTHER){Text("Wymianę prowadzi inny operator.")}
        else {
            if(pick!=null){
                Row(horizontalArrangement=Arrangement.spacedBy(10.dp)){
                    MiniaturaTowaru(graph,pick.tw_id,96.dp,powieksz=!view.busy)
                    Column(Modifier.weight(1f)){Text(pick.sku,fontWeight=FontWeight.Bold,fontSize=20.sp);Text(pick.name);Text("${pick.quantity} szt. z ${pick.bin}",color=InkMute)}
                }
            }
            when(stage){
                WmsRecoveryStage.QUANTITY -> {
                    WertisTextField(quantity,{quantity=it.take(7)},placeholder="Faktycznie pobrane sztuki",keyboardType=KeyboardType.Number,onDone=::confirm)
                    PrimaryButton("POTWIERDŹ ILOŚĆ",enabled=allowed,modifier=Modifier.fillMaxWidth(),onClick=::confirm)
                }
                WmsRecoveryStage.BOX -> Text("${scan.quantity} szt. → ${task.box}. Skan skrzynki po dostarczeniu zapisze ruch.",fontSize=22.sp)
                WmsRecoveryStage.BLOCKED -> Text(task.hold_reason ?: pick?.blocked ?: "Odśwież zadanie lub zwróć niepotwierdzone pobrania.")
                else -> Unit
            }
            if(stage==WmsRecoveryStage.SOURCE || stage==WmsRecoveryStage.BLOCKED)task.picks.filter{it.allocation_id!=pick?.allocation_id}.forEach { p ->
                OutlineButton("${p.bin} · ${p.sku} · ${p.quantity} szt.",enabled=allowed && p.blocked==null,modifier=Modifier.fillMaxWidth()){scan=WmsRecoveryScan(allocationId=p.allocation_id);quantity=""}
            }
        }
        (error ?: view.message)?.let { Text(it,fontWeight=FontWeight.Bold) }
        if(task.user_id==context.actorId && stage!=WmsRecoveryStage.DONE){
            OutlineButton(if(releasing)"WRÓĆ DO WYMIANY" else "PROBLEM / ZWROT POBRAŃ",enabled=allowed,modifier=Modifier.fillMaxWidth()){releasing=!releasing;scan=WmsRecoveryScan();returned=emptySet();reason=""}
        }
        if(stage !in setOf(WmsRecoveryStage.DONE,WmsRecoveryStage.AVAILABLE,WmsRecoveryStage.OTHER))Text("Przed odświeżeniem lub wyjściem zwróć niepotwierdzone sztuki na źródło. Po nieznanym wyniku zapisu użyj PONÓW, bez ponownego ruchu towaru.",color=InkMute)
        OutlineButton("KOLEJKA WYMIAN",enabled=allowed,modifier=Modifier.fillMaxWidth()){query="";queue()}
    }
}
