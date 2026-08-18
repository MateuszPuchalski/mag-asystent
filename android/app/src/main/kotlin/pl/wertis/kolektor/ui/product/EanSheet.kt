package pl.wertis.kolektor.ui.product

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import pl.wertis.kolektor.core.net.ApiError
import pl.wertis.kolektor.core.net.EanOdmowa
import pl.wertis.kolektor.core.net.SetEanBody
import pl.wertis.kolektor.core.product.KrokEan
import pl.wertis.kolektor.core.product.bladKoduEan
import pl.wertis.kolektor.core.product.krokEan
import pl.wertis.kolektor.core.scan.ScanKind
import pl.wertis.kolektor.AppGraph
import pl.wertis.kolektor.net.apiCall
import pl.wertis.kolektor.scan.ScanHandlerEffect
import pl.wertis.kolektor.ui.components.OutlineButton
import pl.wertis.kolektor.ui.components.PrimaryButton
import pl.wertis.kolektor.ui.components.WertisTextField
import pl.wertis.kolektor.ui.theme.CardWhite
import pl.wertis.kolektor.ui.theme.Destructive
import pl.wertis.kolektor.ui.theme.Ink
import pl.wertis.kolektor.ui.theme.InkMute
import pl.wertis.kolektor.ui.theme.InkSoft

/* ── Nadanie kodu kreskowego kartotece (0.37.0) ──────────────────────────────
   POWSTAŁO Z SYTUACJI PRZY REGALE: karton ma kod, kartoteka go nie ma, a jedyną
   drogą było „zapamiętaj i powiedz biuru" — czyli nazajutrz ten sam karton
   zatrzymywał pracę drugi raz.

   Arkusz SAM przechwytuje skan, bo tak wygląda ta czynność w hali: człowiek
   trzyma karton i strzela w kod, zamiast go przepisywać. Wpisanie z ręki
   zostaje jako droga awaryjna dla kodu zdartego albo nieczytelnego.

   Reguła trzech kroków (i to, że ZAJĘTY jest drogą ZAMKNIĘTĄ) mieszka w `:core`
   razem ze swoim testem — patrz `NadanieEan.kt`.                              */

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EanSheet(
    graph: AppGraph,
    twId: Long,
    sym: String,
    nazwa: String,
    /** Kod stojący DZIŚ na kartotece; pusty = pole wolne. */
    eanKartoteki: String,
    /** Kod, z którym arkusz się otwiera (np. nieznany skan) — pusty, gdy brak. */
    kodStartowy: String = "",
    onClose: () -> Unit,
    onZapisano: () -> Unit,
) {
    var kod by remember(twId) { mutableStateOf(kodStartowy) }
    var zajety by remember(twId) { mutableStateOf(false) }
    var blad by remember(twId) { mutableStateOf<String?>(null) }
    var wysylka by remember(twId) { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    /* Skan przechwytujemy TYLKO jako kod towaru. Etykieta regału zeskanowana
       przy otwartym arkuszu nie jest kandydatem na kod kreskowy — oddajemy ją
       niżej, zamiast wstawiać w pole i odrzucać walidacją sekundę później. */
    ScanHandlerEffect { scan ->
        if (scan.kind != ScanKind.EAN) return@ScanHandlerEffect false
        kod = scan.code
        zajety = false
        blad = null
        graph.feedback.beep(true)
        true
    }

    val krok = krokEan(kod, zajety)
    // podmiana to od 0.49.0 informacja, nie bramka — arkusz pokazuje
    // STARY → NOWY, ale zapis idzie tym samym jednym zatwierdzeniem
    val podmiana = eanKartoteki.isNotBlank() && kod.isNotBlank()

    fun zapisz() {
        val walidacja = bladKoduEan(kod)
        if (walidacja != null) {
            blad = walidacja
            graph.feedback.beep(false)
            return
        }
        wysylka = true
        scope.launch {
            try {
                apiCall {
                    graph.api.setEan(
                        twId,
                        SetEanBody(
                            ean = kod.trim(),
                            /* Starszy serwer (≤0.48) przy podmianie żąda tej
                               flagi — wysyłamy ją zawsze, gdy kartoteka ma kod,
                               żeby rozjazd wersji nie kończył się martwym 409.
                               Nowy serwer ją ignoruje. */
                            potwierdzone = if (eanKartoteki.isNotBlank()) true else null,
                        ),
                    )
                }
                graph.feedback.zapis()
                graph.queueRepo.refreshNow()
                onZapisano()
            } catch (e: EanOdmowa) {
                /* Serwer rozstrzyga ostatecznie i to on wie o kodach nadanych
                   przez innych w międzyczasie. `zajety` zamyka drogę. */
                if (e.powod == "zajety") zajety = true
                blad = e.message
                graph.feedback.beep(false)
            } catch (e: ApiError) {
                blad = e.message
                graph.feedback.beep(false)
            } catch (e: Exception) {
                // brak sieci — ta operacja świadomie NIE idzie do bufora offline
                blad = "Brak połączenia z serwerem — kod nadaje się przy zasięgu"
                graph.feedback.beep(false)
            } finally {
                wysylka = false
            }
        }
    }

    ModalBottomSheet(onDismissRequest = onClose, containerColor = CardWhite) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp)
                .padding(bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text("KOD KRESKOWY", fontSize = 11.sp, color = InkMute, fontWeight = FontWeight.Bold)
            Text(sym, fontWeight = FontWeight.Bold, fontSize = 18.sp, color = Ink)
            if (nazwa.isNotBlank()) Text(nazwa, fontSize = 13.sp, color = InkSoft)

            when (krok) {
                KrokEan.SKANUJ -> Text(
                    "Zeskanuj kod z kartonu albo wpisz go poniżej.",
                    fontSize = 14.sp,
                    color = InkSoft,
                )

                KrokEan.UZUPELNIJ -> if (podmiana) {
                    /* Stary i nowy OBOK SIEBIE. To już nie jest pytanie —
                       wymóg potwierdzenia zdjęty w 0.49.0 — ale informacja
                       zostaje: stary kod przestanie wskazywać ten towar,
                       a kartony z nim w hali przestaną się skanować. */
                    Text(
                        "$eanKartoteki  →  $kod",
                        fontWeight = FontWeight.Bold,
                        fontSize = 20.sp,
                        color = Ink,
                    )
                    Text(
                        "Kartoteka ma już kod — zapis go podmieni. Kartony ze " +
                            "starym kodem nie będą się skanować.",
                        fontSize = 13.sp,
                        color = InkSoft,
                    )
                } else {
                    Text(
                        "Kartoteka nie ma kodu — zostanie nadany kod $kod.",
                        fontSize = 14.sp,
                        color = InkSoft,
                    )
                }

                KrokEan.ZAJETY -> Text(
                    "Tego kodu nie da się tu nadać. Zgłoś go biuru — dwie kartoteki " +
                        "z jednym kodem zatrzymują pracę w alejce.",
                    fontSize = 13.sp,
                    color = Destructive,
                )
            }

            if (krok != KrokEan.ZAJETY) {
                WertisTextField(
                    value = kod,
                    onValueChange = {
                        kod = it.trim()
                        blad = null
                    },
                    placeholder = "kod z kartonu",
                    keyboardType = KeyboardType.Number,
                    onDone = { zapisz() },
                )
            }

            blad?.let { Text(it, fontSize = 13.sp, color = Destructive) }

            when (krok) {
                KrokEan.ZAJETY -> OutlineButton(
                    "SPRÓBUJ INNEGO KODU",
                    tall = true,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    kod = ""
                    zajety = false
                    blad = null
                }

                else -> PrimaryButton(
                    if (wysylka) "ZAPISUJĘ…" else if (podmiana) "PODMIEŃ KOD" else "NADAJ KOD",
                    tall = true,
                    enabled = !wysylka && kod.isNotBlank(),
                    modifier = Modifier.fillMaxWidth(),
                ) { zapisz() }
            }

            Text(
                "Anuluj",
                fontSize = 13.sp,
                fontWeight = FontWeight.SemiBold,
                color = InkMute,
                textAlign = TextAlign.Center,
                modifier = Modifier
                    .fillMaxWidth()
                    // 48 dp — anulowanie arkusza nie może wymagać celowania
                    .heightIn(min = 48.dp)
                    .clickable(onClick = onClose)
                    .wrapContentHeight(),
            )
        }
    }
}
