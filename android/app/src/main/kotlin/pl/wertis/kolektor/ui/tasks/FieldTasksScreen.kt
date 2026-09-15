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
import pl.wertis.kolektor.core.net.OdeslijZadanieBody
import pl.wertis.kolektor.core.net.WynikZadaniaBody
import pl.wertis.kolektor.core.net.ZadanieTerenowe
import pl.wertis.kolektor.net.apiCall
import pl.wertis.kolektor.ui.components.OutlineButton
import pl.wertis.kolektor.ui.components.PrimaryButton
import pl.wertis.kolektor.ui.components.SectionLabel
import pl.wertis.kolektor.ui.theme.AmberBg
import pl.wertis.kolektor.ui.theme.AmberInk
import pl.wertis.kolektor.ui.theme.AmberLine
import pl.wertis.kolektor.ui.theme.CardBorder
import pl.wertis.kolektor.ui.theme.CardWhite
import pl.wertis.kolektor.ui.theme.Destructive
import pl.wertis.kolektor.ui.theme.Ink
import pl.wertis.kolektor.ui.theme.InkMute
import pl.wertis.kolektor.ui.theme.InkSoft
import pl.wertis.kolektor.ui.theme.cardSurface

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
        Text("Czego nie da się zrobić, odeślij z powodem — biuro to zobaczy.", fontSize = 12.sp, color = InkSoft)
        if (tasks.isEmpty()) Text("Brak zadań z biura", modifier = Modifier.fillMaxWidth().cardSurface().padding(16.dp), color = InkMute)
        tasks.forEach { task -> FieldTaskCard(task, busy,
            onTake = { scope.launch { busy=true;try { apiCall { graph.api.zadanieTerenoweWez(task.id) };refresh() } catch(e:Exception){graph.effects.toast(e.message?:"Błąd")}finally{busy=false} } },
            onFinish = { result -> scope.launch { busy=true;try { apiCall { graph.api.zadanieTerenoweWykonaj(task.id, WynikZadaniaBody(result)) };graph.feedback.beep(true);graph.effects.toast("Wynik wysłany do biura");refresh() }catch(e:Exception){graph.effects.toast(e.message?:"Błąd")}finally{busy=false} } },
            onReturn = { kod, powod -> scope.launch { busy=true;try { apiCall { graph.api.zadanieTerenoweOdeslij(task.id, OdeslijZadanieBody(kod, powod)) };graph.feedback.beep(true);graph.effects.toast("Odesłane do biura");refresh() }catch(e:Exception){graph.effects.toast(e.message?:"Błąd")}finally{busy=false} } },
            onRelease = { scope.launch { busy=true;try { apiCall { graph.api.zadanieTerenoweOddaj(task.id) };graph.effects.toast("Zadanie wróciło do puli");refresh() }catch(e:Exception){graph.effects.toast(e.message?:"Błąd")}finally{busy=false} } }) }
        OutlineButton("ODŚWIEŻ", modifier = Modifier.fillMaxWidth()) { scope.launch { refresh() } }
    }
}

/**
 * Karta zadania.
 *
 * ŚCIEŻKA GŁÓWNA ZOSTAJE JEDNYM DOTKNIĘCIEM — weź zadanie, wyślij wynik.
 * Odesłanie i oddanie chowają się za jednym „NIE MOGĘ", bo dekalog ergonomii
 * liczy decyzje przy KAŻDYM zadaniu, a te dwie są wyjątkiem, nie regułą.
 * Rozłożenie czterech przycisków na płasko kosztowałoby uwagę przy każdym
 * pomiarze, żeby zaoszczędzić jedno dotknięcie przy co dwudziestym.
 *
 * Powód to WYBÓR Z DWÓCH, nie pole tekstowe. Magazynier stoi przed pustą półką
 * w rękawicy; klawiatura ekranowa jest tu kosztem, nie udogodnieniem. Dopisek
 * zostaje możliwy, ale nigdy wymagany.
 */
@Composable
private fun FieldTaskCard(
    task: ZadanieTerenowe,
    busy: Boolean,
    onTake: () -> Unit,
    onFinish: (String) -> Unit,
    onReturn: (String, String?) -> Unit,
    onRelease: () -> Unit,
) {
    var result by remember(task.id) { mutableStateOf("") }
    var wyjscia by remember(task.id) { mutableStateOf(false) }
    var dopisek by remember(task.id) { mutableStateOf("") }
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
        if (wyjscia) {
            SectionLabel("DLACZEGO NIE")
            OutlineButton("NIE MA TOWARU", modifier = Modifier.fillMaxWidth(), enabled = !busy) { onReturn("brak_towaru", dopisek.ifBlank { null }) }
            OutlineButton("NIE DA SIĘ WYKONAĆ", modifier = Modifier.fillMaxWidth(), enabled = !busy) { onReturn("nie_da_sie", dopisek.ifBlank { null }) }
            // Oddanie stoi OSOBNO i niżej: to nie jest werdykt o zadaniu, tylko
            // o tym, kto je zrobi. Sklejenie go z powodami kazałoby biuru czytać
            // „nie da się" tam, gdzie da się doskonale — po prostu nie dziś i nie
            // przeze mnie.
            if (task.status != "nowe") OutlineButton("ODDAJ INNYM", modifier = Modifier.fillMaxWidth(), enabled = !busy, onClick = onRelease)
            OutlinedTextField(value = dopisek, onValueChange = { dopisek = it }, placeholder = { Text("Dopisek dla biura (nieobowiązkowy)") }, minLines = 2, modifier = Modifier.fillMaxWidth())
            OutlineButton("WRÓĆ", modifier = Modifier.fillMaxWidth(), enabled = !busy) { wyjscia = false }
        } else {
            OutlineButton("NIE MOGĘ", modifier = Modifier.fillMaxWidth(), enabled = !busy, danger = true) { wyjscia = true }
        }
    }
}
