package pl.wertis.kolektor.ui.tasks

import android.content.Context
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import pl.wertis.kolektor.AppGraph
import java.io.File
import pl.wertis.kolektor.core.net.OdeslijZadanieBody
import pl.wertis.kolektor.core.net.ZalacznikZadaniaBody
import pl.wertis.kolektor.device.PhotoCapture
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

/**
 * Wiek zlecenia po ludzku — „41 min", „2 g", „3 dni".
 *
 * Ta sama drabina słów co `wiek()` w panelu, żeby biuro i hala mówiły o tym
 * samym zadaniu tak samo. Minuty bez godzin, bo na kolektorze liczy się rząd
 * wielkości, a nie dokładność: „2 g" wystarcza, żeby sięgnąć po to zadanie
 * przed świeższym.
 */
private fun wiekZlecenia(ms: Long): String {
    val min = ms / 60_000
    if (min < 1) return "przed chwilą"
    val g = min / 60
    if (g >= 24) { val dni = g / 24; return if (dni == 1L) "1 dzień" else "$dni dni" }
    return if (g > 0) "$g g" else "$min min"
}

@Composable
fun FieldTasksScreen(graph: AppGraph) {
    var tasks by remember { mutableStateOf<List<ZadanieTerenowe>>(emptyList()) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val context: Context = LocalContext.current
    suspend fun refresh() { try { tasks = apiCall { graph.api.zadaniaTerenowe() }.zadania.filter { it.status == "nowe" || it.status == "w_toku" } } catch (e: Exception) { graph.effects.toast(e.message ?: "Nie udało się pobrać zadań") } }
    LaunchedEffect(Unit) { refresh() }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        /* ── JEDNA LINIA ZAMIAST TRZECH (0.408.0) ────────────────────────────
           Zgłoszenie właściciela: „skondensuj design na kolektorze". Nad listą
           stały trzy zdania prozy, czytane raz w życiu, a zabierające pasmo
           przy KAŻDYM wejściu na ekran. Obie rzeczy, które mówiły, są i tak
           widoczne z przycisków: wynik ma swój „WYŚLIJ WYNIK DO BIURA",
           a odesłanie — „NIE MOGĘ". Dekalog ergonomii, punkt 2. */
        Text("Zadania z biura", fontSize = 20.sp, fontWeight = FontWeight.Bold, color = Ink)
        if (tasks.isEmpty()) Text("Brak zadań z biura", modifier = Modifier.fillMaxWidth().cardSurface().padding(16.dp), color = InkMute)
        tasks.forEach { task -> FieldTaskCard(task, busy,
            onTake = { scope.launch { busy=true;try { apiCall { graph.api.zadanieTerenoweWez(task.id) };refresh() } catch(e:Exception){graph.effects.toast(e.message?:"Błąd")}finally{busy=false} } },
            onFinish = { result -> scope.launch { busy=true;try { apiCall { graph.api.zadanieTerenoweWykonaj(task.id, WynikZadaniaBody(result)) };graph.feedback.beep(true);graph.effects.toast("Wynik wysłany do biura");refresh() }catch(e:Exception){graph.effects.toast(e.message?:"Błąd")}finally{busy=false} } },
            onReturn = { kod, powod -> scope.launch { busy=true;try { apiCall { graph.api.zadanieTerenoweOdeslij(task.id, OdeslijZadanieBody(kod, powod)) };graph.feedback.beep(true);graph.effects.toast("Odesłane do biura");refresh() }catch(e:Exception){graph.effects.toast(e.message?:"Błąd")}finally{busy=false} } },
            onRelease = { scope.launch { busy=true;try { apiCall { graph.api.zadanieTerenoweOddaj(task.id) };graph.effects.toast("Zadanie wróciło do puli");refresh() }catch(e:Exception){graph.effects.toast(e.message?:"Błąd")}finally{busy=false} } },
            onPhoto = { file, opis -> scope.launch { busy=true;try {
                // Kodowanie NA WĄTKU IO: pełny kadr z aparatu kolektora to
                // kilkanaście megapikseli, a `PhotoCapture.encode` skaluje go
                // w pamięci — na wątku głównym ekran stałby na sekundy.
                val base64 = withContext(Dispatchers.IO) { PhotoCapture.encode(file) }
                if (base64 == null) graph.effects.toast("Nie udało się odczytać zdjęcia — zrób je jeszcze raz")
                else { apiCall { graph.api.zadanieTerenoweZalacznik(task.id, ZalacznikZadaniaBody(base64, opis)) };graph.feedback.beep(true);graph.effects.toast("Zdjęcie poszło do biura");refresh() }
            } catch(e:Exception){graph.effects.toast(e.message?:"Błąd")} finally { PhotoCapture.discard(file);busy=false } } },
            context = context) }
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
    onPhoto: (File, String?) -> Unit,
    context: Context,
) {
    var result by remember(task.id) { mutableStateOf("") }
    var wyjscia by remember(task.id) { mutableStateOf(false) }
    var dopisek by remember(task.id) { mutableStateOf("") }

    /* Aparat wołany systemowym `ACTION_IMAGE_CAPTURE`, jak przy niezgodności
       w dostawie — nie wciągamy CameraX dla jednego kadru, a kolektor ma
       aparat producenta. Plik roboczy kasuje `onPhoto` po zakodowaniu: dowód
       żyje na serwerze, nie w pamięci kolektora, którą ktoś kiedyś wyczyści. */
    var czeka by remember(task.id) { mutableStateOf<File?>(null) }
    val aparat = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        val plik = czeka
        czeka = null
        if (ok && plik != null) onPhoto(plik, dopisek.ifBlank { null }) else PhotoCapture.discard(plik)
    }
    fun zrobZdjecie() {
        runCatching {
            val (plik, uri) = PhotoCapture.newTarget(context, "zadanie")
            czeka = plik
            aparat.launch(uri)
        }.onFailure { /* ergonomia: brak aparatu to nie awaria ekranu */ }
    }
    Column(Modifier.fillMaxWidth().cardSurface(background = if (task.priorytet == "pilny") AmberBg else CardWhite, borderColor = if (task.priorytet == "pilny") AmberLine else CardBorder).padding(13.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        /* ── DWIE RZECZY, NIE SIEDEM (0.408.0) ───────────────────────────────
           Zgłoszenie właściciela: „zadania zlecane dla magazynu mają za dużo
           informacji; powinno być tylko, jakiego produktu dotyczy zadanie —
           lub bez produktu — i co ma zrobić".

           PRODUKT STOI PIERWSZY, w miejscu, które zajmował tytuł. Magazynier
           najpierw ustala, po co idzie i gdzie, a dopiero potem czyta, co ma
           z tym zrobić — dekalog ergonomii, punkt 6: mniej ruchu. Bez towaru
           wiersz nie staje wcale i karta zaczyna się od polecenia.

           TYTUŁU TU NIE MA i to jest decyzja. „Pomiar z rozmowy —
           Client:128497280" jest etykietą DLA BIURA, po której odnajduje się
           zadanie na liście kilkunastu; na hali nie mówi ani o produkcie, ani
           o czynności. Zostaje w bazie i na karcie w panelu.

           ZLECAJĄCEGO TEŻ NIE MA (decyzja właściciela z 19 września 2026):
           wynik wraca do niego automatycznie, więc magazynier nic z tym
           nazwiskiem nie robił. PILNE, półka i wiek ZOSTAJĄ — właściciel
           wskazał je wprost: pierwsze mówi o kolejności, drugie o drodze,
           trzecie czyni porządek listy widocznym. */
        task.symbol?.let { symbol ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Column(Modifier.weight(1f)) {
                    Text(symbol, fontWeight = FontWeight.Bold, fontSize = 17.sp, color = Ink)
                    task.nazwaTowaru?.takeIf { it.isNotBlank() }?.let {
                        Text(it, fontSize = 13.sp, color = InkSoft)
                    }
                }
                if (task.priorytet == "pilny") Text("PILNE", color = Destructive, fontWeight = FontWeight.Bold, fontSize = 11.sp)
            }
        }
        /* Bez towaru plakietka pilności nie ma się przy czym zaczepić, więc
           jedzie w wierszu polecenia — inaczej znikałaby dokładnie w tych
           zadaniach, które bywają najpilniejsze („sprawdź, czy przyszła
           dostawa"). */
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(task.instrukcja, fontSize = 15.sp, color = Ink, modifier = Modifier.weight(1f))
            if (task.priorytet == "pilny" && task.symbol == null) Text("PILNE", color = Destructive, fontWeight = FontWeight.Bold, fontSize = 11.sp)
        }
        task.lokalizacja?.takeIf { it.isNotBlank() }?.let { Text("Półka: $it", color = AmberInk, fontWeight = FontWeight.Bold) }
        // WIEK, NIE ZNACZNIK. Zadanie sprzed trzech dni wyglądało dokładnie tak
        // samo jak sprzed trzech minut, a lista jest posortowana od najstarszych
        // — bez tej liczby porządek listy był niewidoczny i wyglądał na losowy.
        //
        // BEZ PROGU. Kusi, żeby stare zlecenie zapalić na czerwono, ale żadna
        // liczba godzin nie jest tu ustaleniem właściciela — projekt panelu §22
        // wymienia „czas realizacji zadania magazynowego" jako metrykę i NIE
        // podaje terminu. Wyróżniony jest więc sam wiek, przy każdym zadaniu:
        // to fakt. „Za późno" byłoby werdyktem, którego nikt nie wydał.
        task.zleconeOdMs?.let {
            Text("${wiekZlecenia(it)} temu", fontSize = 11.sp, color = Ink, fontWeight = FontWeight.Bold)
        }
        if (task.status == "nowe") PrimaryButton("WEŹ ZADANIE", modifier = Modifier.fillMaxWidth(), enabled = !busy, onClick = onTake)
        else {
            SectionLabel("WYNIK")
            OutlinedTextField(value = result, onValueChange = { result = it }, placeholder = { Text("Np. 46 mm, od środka do środka") }, minLines = 3, modifier = Modifier.fillMaxWidth())
            PrimaryButton("WYŚLIJ WYNIK DO BIURA", modifier = Modifier.fillMaxWidth(), enabled = result.isNotBlank() && !busy) { onFinish(result) }
        }
        // ZDJĘCIE PRZY KAŻDYM OTWARTYM ZADANIU, nie tylko przy wyniku: bywa
        // odpowiedzią samo w sobie („co jest na tabliczce"), a bywa dowodem do
        // odesłania („oto pusta półka"). Osobny przycisk, bo jedno zadanie
        // przyjmuje kilka kadrów — półka, etykieta, suwmiarka.
        OutlineButton("ZRÓB ZDJĘCIE", modifier = Modifier.fillMaxWidth(), enabled = !busy) { zrobZdjecie() }
        if (task.zalaczniki.isNotEmpty()) {
            Text(
                "Wysłane zdjęcia: ${task.zalaczniki.size}",
                fontSize = 11.sp,
                color = InkMute,
            )
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
