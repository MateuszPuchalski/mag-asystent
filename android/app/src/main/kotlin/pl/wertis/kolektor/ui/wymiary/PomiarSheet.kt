package pl.wertis.kolektor.ui.wymiary

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import pl.wertis.kolektor.AppGraph
import pl.wertis.kolektor.core.net.ApiError
import pl.wertis.kolektor.core.net.TowarDoPomiaru
import pl.wertis.kolektor.core.wymiary.PolePomiaru
import pl.wertis.kolektor.core.wymiary.bladPomiaru
import pl.wertis.kolektor.core.wymiary.cialoPomiaru
import pl.wertis.kolektor.core.wymiary.cokolwiekWpisane
import pl.wertis.kolektor.core.wymiary.nastepnePole
import pl.wertis.kolektor.core.wymiary.obecne
import pl.wertis.kolektor.core.wymiary.podpisObecnego
import pl.wertis.kolektor.core.wymiary.poleStartowe
import pl.wertis.kolektor.core.wymiary.wpisLiczby
import pl.wertis.kolektor.net.apiCall
import pl.wertis.kolektor.ui.components.LokPastylka
import pl.wertis.kolektor.ui.components.MinTap
import pl.wertis.kolektor.ui.components.PrimaryButton
import pl.wertis.kolektor.ui.components.WertisTextField
import pl.wertis.kolektor.ui.theme.CardWhite
import pl.wertis.kolektor.ui.theme.Destructive
import pl.wertis.kolektor.ui.theme.Ink
import pl.wertis.kolektor.ui.theme.InkMute
import pl.wertis.kolektor.ui.theme.InkSoft

/* ── Formularz pomiaru: waga i wymiary jednej kartoteki ─────────────────────
   Ten sam arkusz otwiera lista „Do zmierzenia" i karta towaru, więc reguła
   zapisu jest jedna. Reguły pól (kolejność, pole startowe, walidacja, ciało)
   mieszkają w `:core`, w `wymiary/Pomiar.kt`, razem z testem.

   Waga i miarka zajmują ręce. Całość ma się dać przejść samą klawiaturą:
   kursor staje w pierwszym brakującym polu, „Dalej" prowadzi w dół,
   a „Gotowe" w ostatnim polu zapisuje.

   Pod każdym polem stoi to, co kartoteka już ma. Człowiek mierzy wyłącznie
   braki, a pole zostawione puste nie jedzie do Subiekta wcale.

   BEZ BUFORA OFFLINE, jak nadanie kodu kreskowego. Odmowa serwera (netto
   ponad brutto, zła jednostka) ma paść przy wadze, gdy towar da się zważyć
   jeszcze raz. Bez sieci formularz zostaje otwarty z wpisanymi liczbami.     */

/**
 * Fokus na pole. Arkusz bywa jeszcze niepodpięty w pierwszej klatce; brak
 * fokusu kosztuje jedno dotknięcie pola, a wyjątek kosztowałby cały ekran.
 */
private fun fokusNa(fokusy: Map<PolePomiaru, FocusRequester>, pole: PolePomiaru) {
    runCatching { fokusy.getValue(pole).requestFocus() }
}

/**
 * @param onZapisano pomiar przyjęty do kolejki; arkusz sam już dał sygnał
 *   i komunikat, wołający tylko decyduje, co dalej
 * @param onWylaczone serwer odpowiedział, że funkcja jest wyłączona (409);
 *   lista ma się przeładować i pokazać powód zamiast martwego formularza
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PomiarSheet(
    graph: AppGraph,
    towar: TowarDoPomiaru,
    onClose: () -> Unit,
    onZapisano: () -> Unit,
    onWylaczone: () -> Unit = {},
) {
    var wpisy by remember(towar.twId) { mutableStateOf(PolePomiaru.entries.associateWith { "" }) }
    var blad by remember(towar.twId) { mutableStateOf<String?>(null) }
    var wysylka by remember(towar.twId) { mutableStateOf(false) }
    val fokusy = remember(towar.twId) { PolePomiaru.entries.associateWith { FocusRequester() } }
    val scope = rememberCoroutineScope()
    /* Pięć pól z klawiaturą nie mieści się w połowie ekranu, a arkusz
       zatrzymany w pół drogi chowałby przycisk zapisu pod klawiaturą. */
    val stanArkusza = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    LaunchedEffect(towar.twId) { fokusNa(fokusy, poleStartowe(towar)) }

    fun zapisz() {
        if (wysylka || !cokolwiekWpisane(wpisy)) return
        val zle = bladPomiaru(wpisy, towar)
        if (zle != null) {
            blad = zle
            graph.feedback.beep(false)
            return
        }
        wysylka = true
        scope.launch {
            try {
                apiCall { graph.api.zapiszPomiar(towar.twId, cialoPomiaru(wpisy)) }
                graph.feedback.zapis()
                graph.queueRepo.refreshNow()
                /* Kartoteka w Subiekcie zmieni się dopiero po workerze. Zdanie
                   mówi to wprost, zamiast udawać, że zapis już tam jest. */
                graph.effects.toast("Do Subiekta trafi z kolejki")
                onZapisano()
            } catch (e: ApiError) {
                // zdanie serwera, nie kod — 400 mówi, które pole i dlaczego
                blad = e.message ?: "Serwer nie przyjął pomiaru"
                graph.feedback.beep(false)
                if (e.status == 409) onWylaczone()
            } catch (e: Exception) {
                blad = "Brak połączenia z serwerem. Pomiar zostaje w formularzu — zapisz go przy zasięgu."
                graph.feedback.beep(false)
            } finally {
                wysylka = false
            }
        }
    }

    ModalBottomSheet(onDismissRequest = onClose, sheetState = stanArkusza, containerColor = CardWhite) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp)
                .padding(bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text("ZWAŻ I ZMIERZ", fontSize = 11.sp, color = InkMute, fontWeight = FontWeight.Bold)
            Text(towar.symbol, fontWeight = FontWeight.Bold, fontSize = 18.sp, color = Ink)
            if (towar.nazwa.isNotBlank()) Text(towar.nazwa, fontSize = 13.sp, color = InkSoft)
            /* Adres przy symbolu: formularz zasłania listę, a pomyłka towaru
               przy wadze jest cicha — liczby trafiłyby do cudzej kartoteki. */
            towar.lokalizacja?.takeIf { it.isNotBlank() }?.let { LokPastylka(it, przygaszona = false) }

            PolePomiaru.entries.forEach { pole ->
                val nastepne = nastepnePole(pole)
                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(
                        "${pole.etykieta} (${pole.jednostka})",
                        fontSize = 13.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = Ink,
                    )
                    WertisTextField(
                        value = wpisy.getValue(pole),
                        onValueChange = {
                            wpisy = wpisy + (pole to wpisLiczby(it))
                            blad = null
                        },
                        modifier = Modifier.focusRequester(fokusy.getValue(pole)),
                        placeholder = obecne(towar, pole) ?: "np. 12,5",
                        keyboardType = KeyboardType.Decimal,
                        imeAction = if (nastepne == null) ImeAction.Done else ImeAction.Next,
                        onDone = { zapisz() },
                        // wprost do następnego pola z listy — „w dół" zależałby od układu ekranu
                        onNext = if (nastepne == null) null else ({ fokusNa(fokusy, nastepne) }),
                    )
                    Text(podpisObecnego(towar, pole), fontSize = 12.sp, color = InkMute)
                }
            }

            blad?.let { Text(it, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = Destructive) }

            PrimaryButton(
                if (wysylka) "ZAPISUJĘ…" else "ZAPISZ POMIAR",
                tall = true,
                enabled = !wysylka && cokolwiekWpisane(wpisy),
                modifier = Modifier.fillMaxWidth(),
            ) { zapisz() }

            Text(
                "Puste pole zostaje w Subiekcie bez zmian",
                fontSize = 12.sp,
                color = InkMute,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth(),
            )
            Text(
                "Anuluj",
                fontSize = 13.sp,
                fontWeight = FontWeight.SemiBold,
                color = InkMute,
                textAlign = TextAlign.Center,
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = MinTap)
                    .clickable(onClick = onClose)
                    .wrapContentHeight(),
            )
        }
    }
}
