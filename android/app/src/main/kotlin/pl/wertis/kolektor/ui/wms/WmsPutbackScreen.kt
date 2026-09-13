package pl.wertis.kolektor.ui.wms

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
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
import pl.wertis.kolektor.core.wms.WmsPutbackDraft
import pl.wertis.kolektor.core.wms.WmsReturnScan
import pl.wertis.kolektor.core.wms.WmsReturnStage
import pl.wertis.kolektor.core.wms.putbackClaim
import pl.wertis.kolektor.core.wms.putbackRelease
import pl.wertis.kolektor.core.wms.putbackScan
import pl.wertis.kolektor.core.wms.returnCode
import pl.wertis.kolektor.core.wms.returnQuantity
import pl.wertis.kolektor.core.wms.returnStage
import pl.wertis.kolektor.ui.components.OutlineButton
import pl.wertis.kolektor.ui.components.PrimaryButton
import pl.wertis.kolektor.ui.components.WertisTextField

@Composable
fun WmsPutbackScreen(graph:AppGraph) {
    val session by graph.session.state.collectAsStateWithLifecycle()
    val settings by graph.settings.settings.collectAsStateWithLifecycle()
    val context=remember(session,settings.serverUrl){graph.wmsRepo.context()}
    val controller=graph.wmsRepo.putback
    val view by controller.state.collectAsStateWithLifecycle()
    val task=view.task.takeIf{view.context==context}
    val part=task?.picks?.firstOrNull()
    var scan by remember(view.generation,view.confirmedBox,context){mutableStateOf(WmsReturnScan(box=task!=null && view.confirmedBox==task.box))}
    var damaged by remember(view.generation,context){mutableStateOf(false)}
    var damageReason by remember(view.generation,context){mutableStateOf("")}
    var quantity by remember(view.generation,context){mutableStateOf("")}
    var station by remember(view.generation,context){mutableStateOf("")}
    var releasing by remember(view.generation,context){mutableStateOf(false)}
    var reason by remember(view.generation,context){mutableStateOf("")}
    var error by remember(view.generation,context){mutableStateOf<String?>(null)}
    var query by remember(view.query,context){mutableStateOf(view.query)}
    val allowed=context!=null && view.context==context && view.ready && !view.busy && view.journal.pending==null
    WmsLifecycleEffect(graph,context,controller::activateVerification,controller::invalidateVerification,controller::open)
    fun submit(draft:WmsPutbackDraft){val bound=context?:return;error=null;graph.appScope.launch{controller.submit(bound,draft);if(controller.state.value.ready && controller.state.value.message==null)graph.feedback.zapis() else graph.feedback.beep(false)}}
    fun queue(offset:Int=0){context?.let{bound->graph.appScope.launch{controller.queue(bound,query,offset)}}}
    fun confirm(){if(allowed && part!=null)try{scan=returnQuantity(part,scan,quantity);error=null}catch(e:IllegalArgumentException){error=e.message;graph.feedback.beep(false)}}
    WmsScanHandlerEffect { input ->
        if(allowed)try {
            val raw=input.rawCode.trim()
            if(task==null){query=raw;queue()}
            else if(task.completed_at!=null || task.cancelled_at!=null)error="Zadanie zakończone. Wróć do kolejki."
            else if(task.user_id==null || releasing){
                if(releasing)require(reason.trim().length in 3..500){"Najpierw podaj powód zwolnienia"}
                if(station.isEmpty()){require(raw==task.station){"Zeskanuj stanowisko ${task.station}"};station=raw;error=null;graph.feedback.beep(true)}
                else submit(if(releasing)putbackRelease(task,context!!.actorId,station,raw,reason)else putbackClaim(task,station,raw))
            } else {
                require(part!=null){"Odśwież zwrot"}
                val result=putbackScan(task,context!!.actorId,part,scan,returnCode(scan,input),damaged,damageReason);scan=result.first;error=null
                result.second?.let(::submit)?:graph.feedback.beep(true)
            }
        }catch(e:IllegalArgumentException){error=e.message;graph.feedback.beep(false)}
        true
    }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),verticalArrangement=Arrangement.spacedBy(12.dp)) {
        if(context==null){Text("Zaloguj się ponownie.");return@Column}
        if(!allowed){
            Text(if(view.busy)"Potwierdzam na serwerze…" else "Zwrot wstrzymany",fontSize=22.sp,fontWeight=FontWeight.Bold)
            Text(view.message?:"Czekam na świeży stan zadania.")
            view.journal.pending?.let{pending->WmsPendingNotice(graph,pending,context,"putback",view.busy){graph.appScope.launch{controller.retry(context)}}}
            OutlineButton("SPRAWDŹ STAN",enabled=!view.busy,modifier=Modifier.fillMaxWidth()){graph.appScope.launch{controller.open(context)}}
            return@Column
        }
        if(task==null){
            Text("${view.queue?.total?:0} zleconych zwrotów",fontSize=22.sp,fontWeight=FontWeight.Bold)
            Text("Samo wstrzymanie nie zleca zwrotu. Odbieraj wyłącznie wskazaną skrzynkę ze stanowiska.")
            WertisTextField(query,{query=it.take(120)},placeholder="Zamówienie lub skrzynka",onDone={queue()})
            PrimaryButton("SZUKAJ",modifier=Modifier.fillMaxWidth()){queue()}
            view.queue?.rows?.forEach{r->OutlineButton("${r.reference} · ${r.remaining} szt.\n${r.station} · ${r.box}${if(r.user_id!=null)" · podjęty" else ""}",modifier=Modifier.fillMaxWidth()){graph.appScope.launch{controller.select(context,r.id)}}}
            Row(horizontalArrangement=Arrangement.spacedBy(10.dp)){
                OutlineButton("POPRZEDNIE",enabled=view.offset>0,modifier=Modifier.weight(1f)){queue((view.offset-50).coerceAtLeast(0))}
                OutlineButton("NASTĘPNE",enabled=view.offset+50<(view.queue?.total?:0),modifier=Modifier.weight(1f)){queue(view.offset+50)}
            }
        }else{
            Text(task.reference,fontSize=22.sp,fontWeight=FontWeight.Bold)
            Text("Skrzynka ${task.box}",fontSize=24.sp,fontWeight=FontWeight.ExtraBold)
            Text("Zlecenie: ${task.reason}")
            when {
                task.completed_at!=null -> Text("Wszystkie pobrania odłożone. Zamówienie pozostaje wstrzymane dla decyzji biura.")
                task.cancelled_at!=null -> Text("Biuro przerwało zlecenie. Nie odkładaj kolejnych sztuk.")
                task.user_id!=null && task.user_id!=context.actorId -> Text("Skrzynkę obsługuje inny operator.")
                task.user_id==null -> {
                    Text("Na ${task.station} przełóż całą niewysłaną zawartość tego zamówienia z paczek do ${task.box}. Dobre części wrócą na półki przez osobne skany.")
                    Text(if(station.isEmpty())"1. SKANUJ STANOWISKO ${task.station}" else "2. SKANUJ SKRZYNKĘ I ODBIERZ CAŁĄ ZAWARTOŚĆ",fontSize=22.sp,fontWeight=FontWeight.Bold)
                }
                releasing -> {
                    Text("Włóż wszystkie niepotwierdzone sztuki do ${task.box}. Zwróć skrzynkę z resztą na ${task.station}. Odłożonych partii nie zabieraj z półek.")
                    WertisTextField(reason,{reason=it.take(500)},placeholder="Powód zwolnienia")
                    Text(if(station.isEmpty())"SKANUJ STANOWISKO ${task.station}" else "SKANUJ ZWRÓCONĄ SKRZYNKĘ ${task.box}",fontWeight=FontWeight.Bold)
                    OutlineButton("KONTYNUUJ ZWROT",modifier=Modifier.fillMaxWidth()){releasing=false;station="";scan=WmsReturnScan();error=null}
                }
                part!=null -> {
                    Text("${part.sku} · ${part.name}",fontSize=18.sp)
                    Text("Pozostało ${part.remaining} szt. · pobrano z ${part.bin}")
                    Row(horizontalArrangement=Arrangement.spacedBy(10.dp)) {
                        OutlineButton(if(!damaged)"✓ SPRAWNE" else "SPRAWNE",enabled=damaged,modifier=Modifier.weight(1f)){damaged=false;scan=WmsReturnScan(box=scan.box);quantity="";damageReason="";error=null}
                        OutlineButton(if(damaged)"✓ USZKODZONE" else "USZKODZONE",enabled=!damaged,modifier=Modifier.weight(1f)){damaged=true;scan=WmsReturnScan(box=scan.box);quantity="";damageReason="";error=null}
                    }
                    if(damaged) WertisTextField(damageReason,{damageReason=it.take(500)},placeholder="Opis uszkodzenia")
                    when(returnStage(scan)){
                        WmsReturnStage.BOX->Text("SKANUJ SKRZYNKĘ ${task.box}",fontSize=22.sp,fontWeight=FontWeight.Bold)
                        WmsReturnStage.PRODUCT->Text("SKANUJ CZĘŚĆ",fontSize=22.sp,fontWeight=FontWeight.Bold)
                        WmsReturnStage.QUANTITY->{
                            WertisTextField(quantity,{quantity=it},placeholder="Policzona ilość",keyboardType=KeyboardType.Number,onDone=::confirm)
                            PrimaryButton("POTWIERDŹ ILOŚĆ",modifier=Modifier.fillMaxWidth(),onClick=::confirm)
                        }
                        WmsReturnStage.BIN->{
                            Text(if(damaged)"Odłóż ${scan.quantity} uszkodzonych sztuk do kwarantanny i zeskanuj jej lokalizację." else if(scan.alternative || part.source_mode!="pick")"Odłóż ${scan.quantity} szt. na inną półkę kompletacji. Sprawdź miejsce i zeskanuj cel." else "Odłóż ${scan.quantity} szt. na ${part.bin} i zeskanuj półkę.",fontSize=22.sp,fontWeight=FontWeight.Bold)
                            if(!damaged) OutlineButton("INNA PÓŁKA",modifier=Modifier.fillMaxWidth()){scan=scan.copy(alternative=true)}
                            OutlineButton("ZMIEŃ ILOŚĆ",modifier=Modifier.fillMaxWidth()){scan=scan.copy(quantity=null)}
                        }
                    }
                    Text("Brakuje fizycznej sztuki? Oddaj resztę na stanowisko i zwolnij zadanie do przeliczenia przez biuro.")
                    OutlineButton("ODDAJ RESZTĘ I ZWOLNIJ ZADANIE",modifier=Modifier.fillMaxWidth()){releasing=true;station="";error=null}
                }
            }
            OutlineButton("KOLEJKA ZWROTÓW",modifier=Modifier.fillMaxWidth()){queue()}
            OutlineButton("ODŚWIEŻ ZADANIE",modifier=Modifier.fillMaxWidth()){graph.appScope.launch{controller.select(context,task.id)}}
        }
        error?.let{Text(it,fontWeight=FontWeight.Bold)}
        view.message?.let{Text(it,fontWeight=FontWeight.Bold)}
    }
}
