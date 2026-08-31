package pl.wertis.kolektor.ui.tasks

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import pl.wertis.kolektor.AppGraph
import pl.wertis.kolektor.core.net.WynikZadaniaBody
import pl.wertis.kolektor.core.net.ZadanieTerenowe
import pl.wertis.kolektor.net.apiCall
import pl.wertis.kolektor.ui.components.OutlineButton
import pl.wertis.kolektor.ui.components.PrimaryButton
import pl.wertis.kolektor.ui.components.SectionLabel
import pl.wertis.kolektor.ui.theme.*

@Composable
fun FieldTasksScreen(graph: AppGraph) {
    var tasks by remember { mutableStateOf<List<ZadanieTerenowe>>(emptyList()) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    suspend fun refresh() { try { tasks = apiCall { graph.api.zadaniaTerenowe() }.zadania.filter { it.status == "nowe" || it.status == "w_toku" } } catch (e: Exception) { graph.effects.toast(e.message ?: "Nie udało się pobrać zadań") } }
    LaunchedEffect(Unit) { refresh() }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text("Pomiary i weryfikacje", fontSize = 20.sp, fontWeight = FontWeight.Bold, color = Ink)
        Text("Wynik wróci bezpośrednio do osoby obsługującej klienta.", fontSize = 12.sp, color = InkSoft)
        if (tasks.isEmpty()) Text("Brak zadań z biura", modifier = Modifier.fillMaxWidth().cardSurface().padding(16.dp), color = InkMute)
        tasks.forEach { task -> FieldTaskCard(task, busy, onTake = { scope.launch { busy=true;try { apiCall { graph.api.zadanieTerenoweWez(task.id) };refresh() } catch(e:Exception){graph.effects.toast(e.message?:"Błąd")}finally{busy=false} } }, onFinish = { result -> scope.launch { busy=true;try { apiCall { graph.api.zadanieTerenoweWykonaj(task.id, WynikZadaniaBody(result)) };graph.feedback.beep(true);graph.effects.toast("Wynik wysłany do biura");refresh() }catch(e:Exception){graph.effects.toast(e.message?:"Błąd")}finally{busy=false} } }) }
        OutlineButton("ODŚWIEŻ", modifier = Modifier.fillMaxWidth()) { scope.launch { refresh() } }
    }
}

@Composable
private fun FieldTaskCard(task: ZadanieTerenowe, busy: Boolean, onTake: () -> Unit, onFinish: (String) -> Unit) {
    var result by remember(task.id) { mutableStateOf("") }
    Column(Modifier.fillMaxWidth().cardSurface(background = if (task.priorytet == "pilny") AmberBg else CardWhite, borderColor = if (task.priorytet == "pilny") AmberLine else CardBorder).padding(13.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) { Text(task.tytul, fontWeight = FontWeight.Bold, fontSize = 17.sp, color = Ink, modifier = Modifier.weight(1f)); if (task.priorytet == "pilny") Text("PILNE", color = Destructive, fontWeight = FontWeight.Bold, fontSize = 11.sp) }
        Text(task.instrukcja, fontSize = 14.sp, color = InkSoft)
        task.symbol?.let { Text("$it · ${task.nazwaTowaru.orEmpty()}", fontWeight = FontWeight.SemiBold, color = Ink) }
        task.lokalizacja?.takeIf { it.isNotBlank() }?.let { Text("Półka: $it", color = AmberInk, fontWeight = FontWeight.Bold) }
        Text("Zlecił(a): ${task.utworzonoPrzez}", fontSize = 11.sp, color = InkMute)
        if (task.status == "nowe") PrimaryButton("WEŹ ZADANIE", modifier = Modifier.fillMaxWidth(), enabled = !busy, onClick = onTake)
        else {
            SectionLabel("WYNIK")
            OutlinedTextField(value = result, onValueChange = { result = it }, placeholder = { Text("Np. 46 mm, od środka do środka") }, minLines = 3, modifier = Modifier.fillMaxWidth())
            PrimaryButton("WYŚLIJ WYNIK DO BIURA", modifier = Modifier.fillMaxWidth(), enabled = result.isNotBlank() && !busy) { onFinish(result) }
        }
    }
}
