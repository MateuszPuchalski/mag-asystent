package pl.wertis.kolektor.ui.karton

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import pl.wertis.kolektor.AppGraph
import pl.wertis.kolektor.core.karton.FazaKartonu
import pl.wertis.kolektor.core.karton.fazaKartonu
import pl.wertis.kolektor.core.karton.kolejnoscZbierania
import pl.wertis.kolektor.core.net.DodajDoKartonuBody
import pl.wertis.kolektor.core.net.IloscKartonuBody
import pl.wertis.kolektor.core.net.KoszPozycja
import pl.wertis.kolektor.core.net.KoszView
import pl.wertis.kolektor.core.scan.ScanKind
import pl.wertis.kolektor.core.text.MAKS_ILOSC_WPISU
import pl.wertis.kolektor.core.text.formatQty
import pl.wertis.kolektor.core.text.iloscZJednostka
import pl.wertis.kolektor.core.text.iloscZWpisu
import pl.wertis.kolektor.net.apiCall
import pl.wertis.kolektor.scan.ScanHandlerEffect
import pl.wertis.kolektor.ui.components.LoadingRow
import pl.wertis.kolektor.ui.components.OutlineButton
import pl.wertis.kolektor.ui.components.PrimaryButton
import pl.wertis.kolektor.ui.components.WIcons
import pl.wertis.kolektor.ui.components.WertisTextField
import pl.wertis.kolektor.ui.kosze.KoszScreen
import pl.wertis.kolektor.ui.theme.AmberBg
import pl.wertis.kolektor.ui.theme.AmberInk
import pl.wertis.kolektor.ui.theme.BarlowCond
import pl.wertis.kolektor.ui.theme.Destructive
import pl.wertis.kolektor.ui.theme.Ink
import pl.wertis.kolektor.ui.theme.InkMute
import pl.wertis.kolektor.ui.theme.InkSoft
import pl.wertis.kolektor.ui.theme.cardSurface

/* ── KARTON: zbieranie zawartości ────────────────────────────────────────────
   Ekran ma DWIE fazy i przełącza je STATUS kosza, nie osobny przełącznik —
   dwa źródła prawdy o tym samym rozjeżdżają się przy pierwszym błędzie sieci.

     otwarty   → to, co niżej: dokładanie towaru skanem albo symbolem,
     zamkniety → `KoszScreen`, bez zmian, bo rozkładanie kartonu i rozkładanie
                 kosza to ta sama praca i ta sama gramatyka skanu.

   Skan znaczy JEDNĄ SZTUKĘ i sumuje się na istniejącej pozycji. Tak wygląda
   praca przy pudle: człowiek wyjmuje sztukę po sztuce i nie liczy najpierw
   całości. Liczbę wpisuje się wtedy, gdy ktoś już policzył — sto sztuk to sto
   stuknięć w plus, czyli droga, której nikt nie przejdzie.

   Lista idzie od NAJNOWSZEJ pozycji (`kolejnoscZbierania`), bo jedyne pytanie
   przy zbieraniu brzmi „czy to, co przed chwilą zeskanowałem, weszło".        */

@Composable
fun KartonScreen(graph: AppGraph) {
    val id = graph.nav.koszId ?: return
    val scope = rememberCoroutineScope()
    var reload by remember { mutableStateOf(0) }
    var karton by remember { mutableStateOf<KoszView?>(null) }
    var wpisKodu by remember { mutableStateOf("") }
    var wpisIlosci by remember { mutableStateOf("") }
    /* Pozycja, której ilość poprawiamy z klawiatury. Jedna naraz — poprawka
       jest odpowiedzią na policzenie konkretnego towaru, nie trybem pracy. */
    var edytowana by remember { mutableStateOf<Long?>(null) }
    var wpisPoprawki by remember { mutableStateOf("") }

    LaunchedEffect(id, reload) {
        try {
            karton = apiCall { graph.api.kosz(id) }.kosz
        } catch (e: Exception) {
            graph.effects.toast(e.message ?: "Nie udało się wczytać kartonu")
        }
    }

    fun dodaj(code: String, ilosc: Double?) {
        val czysty = code.trim()
        if (czysty.isEmpty()) return
        scope.launch {
            try {
                val r = apiCall { graph.api.kartonDodaj(id, DodajDoKartonuBody(czysty, ilosc)) }
                if (r.nieznany) {
                    graph.feedback.beep(false)
                    graph.effects.toast("Nieznany kod: $czysty")
                } else {
                    graph.feedback.beep(true)
                    /* Meldunek podaje ILOŚĆ PO DODANIU, a nie „dodano 1".
                       Przy sumowaniu to jedyna liczba, o którą się tu pyta. */
                    graph.effects.toast("${r.symbol} · ${formatQty(r.ilosc)} w kartonie")
                    wpisKodu = ""
                    wpisIlosci = ""
                    reload++
                }
            } catch (e: Exception) {
                graph.feedback.beep(false)
                graph.effects.toast(e.message ?: "Nie udało się dodać towaru")
            }
        }
    }

    fun zapiszIlosc(pozycjaId: Long, tekst: String) {
        val ile = iloscZWpisu(tekst)
        if (ile == null || ile <= 0.0) {
            graph.effects.toast("Ilość musi być liczbą większą od zera")
            return
        }
        scope.launch {
            try {
                apiCall { graph.api.kartonIlosc(pozycjaId, IloscKartonuBody(ile)) }
                edytowana = null
                graph.feedback.beep(true)
                reload++
            } catch (e: Exception) {
                graph.effects.toast(e.message ?: "Nie udało się zmienić ilości")
            }
        }
    }

    fun usun(pozycjaId: Long) {
        scope.launch {
            try {
                apiCall { graph.api.kartonUsun(pozycjaId) }
                edytowana = null
                reload++
            } catch (e: Exception) {
                graph.effects.toast(e.message ?: "Nie udało się usunąć pozycji")
            }
        }
    }

    val k = karton
    /* Skan przechwytujemy TYLKO w zbiórce. W rozkładaniu robi to `KoszScreen`
       niżej i dwa handlery na jeden skan znaczyłyby dwie różne reakcje. */
    ScanHandlerEffect { scan ->
        /* Skan w trakcie wczytywania POŁYKAMY. Puszczony dalej trafiłby do
           globalnego zapasu i otworzył kartę towaru — czyli zabrałby ekran
           człowiekowi, który właśnie stanął przy pudle. */
        if (k == null) return@ScanHandlerEffect true
        if (fazaKartonu(k.status) != FazaKartonu.ZBIORKA) return@ScanHandlerEffect false
        if (scan.kind == ScanKind.LOC) {
            graph.feedback.beep(false)
            graph.effects.toast("To adres półki — do kartonu skanuje się TOWAR")
        } else {
            dodaj(scan.code, null)
        }
        true
    }

    if (k == null) {
        LoadingRow("Wczytywanie kartonu…")
        return
    }
    if (fazaKartonu(k.status) != FazaKartonu.ZBIORKA) {
        // zatwierdzony karton jest zwykłym koszem do rozłożenia — ten sam ekran
        KoszScreen(graph)
        return
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 12.dp)
            .padding(top = 12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(
            "KARTON ${k.kod} · ZBIÓRKA · ${k.pozycje.size} POZ.",
            fontSize = 11.sp,
            fontWeight = FontWeight.Bold,
            letterSpacing = 1.2.sp,
            color = InkSoft,
        )
        Text(
            "Skanuj towar — każdy skan to jedna sztuka. Większą liczbę wpisz obok symbolu.",
            fontSize = 12.sp,
            color = InkMute,
        )
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            WertisTextField(
                value = wpisKodu,
                onValueChange = { wpisKodu = it },
                placeholder = "symbol albo EAN",
                leadingIcon = WIcons.Search,
                modifier = Modifier.weight(1f),
                onDone = { dodaj(wpisKodu, iloscZWpisu(wpisIlosci)) },
            )
            WertisTextField(
                value = wpisIlosci,
                onValueChange = { wpisIlosci = it },
                placeholder = "szt.",
                keyboardType = KeyboardType.Number,
                modifier = Modifier.weight(0.45f),
                onDone = { dodaj(wpisKodu, iloscZWpisu(wpisIlosci)) },
            )
        }
        OutlineButton("DODAJ", modifier = Modifier.fillMaxWidth()) {
            dodaj(wpisKodu, iloscZWpisu(wpisIlosci))
        }

        /* ZATWIERDŹ dopiero przy niepustym pudle. Pusty karton i tak odmówi na
           serwerze, ale przycisk, który zawsze odmawia, uczy nie ufać reszcie. */
        if (k.pozycje.isNotEmpty()) {
            PrimaryButton(
                "ZATWIERDŹ — ${k.pozycje.size} POZ. DO ROZŁOŻENIA",
                tall = true,
                modifier = Modifier.fillMaxWidth(),
            ) {
                scope.launch {
                    try {
                        apiCall { graph.api.kartonZatwierdz(id) }
                        graph.feedback.beep(true)
                        reload++
                    } catch (e: Exception) {
                        graph.effects.toast(e.message ?: "Nie udało się zatwierdzić")
                    }
                }
            }
        }

        Column(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f)
                .verticalScroll(rememberScrollState())
                .padding(bottom = 12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            if (k.pozycje.isEmpty()) {
                Text("Karton jest pusty. Zeskanuj pierwszy towar.", fontSize = 13.sp, color = InkMute)
            }
            kolejnoscZbierania(k.pozycje) { it.id }.forEach { p ->
                ZbieranaPozycja(
                    p = p,
                    edytowana = edytowana == p.id,
                    wpis = wpisPoprawki,
                    onWpis = { wpisPoprawki = it },
                    onEdytuj = {
                        edytowana = p.id
                        wpisPoprawki = formatQty(p.ilosc)
                    },
                    onZapisz = { zapiszIlosc(p.id, wpisPoprawki) },
                    onUsun = { usun(p.id) },
                )
            }
        }
    }
}

/**
 * Wiersz zbieranej pozycji: co to jest, ile tego jest, i dwa wyjścia z pomyłki.
 *
 * Ilość jest KLIKALNA, bo poprawianie liczby jest tu częstsze niż wszystko
 * inne — ktoś doliczył resztę pudła albo zeskanował dwa razy tę samą sztukę.
 * Kosz na śmieci obok, bo trzeci skan bywa cudzym towarem, którego w tym pudle
 * w ogóle nie ma; przed ZATWIERDŹ wiersz wolno skasować bez śladu, bo nie jest
 * jeszcze zapisem tego, co leży w środku.
 */
@Composable
private fun ZbieranaPozycja(
    p: KoszPozycja,
    edytowana: Boolean,
    wpis: String,
    onWpis: (String) -> Unit,
    onEdytuj: () -> Unit,
    onZapisz: () -> Unit,
    onUsun: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .cardSurface()
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().heightIn(min = 44.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Column(Modifier.weight(1f)) {
                Text(
                    p.symbol,
                    fontFamily = BarlowCond,
                    fontWeight = FontWeight.Bold,
                    fontSize = 17.sp,
                    color = Ink,
                )
                Text(
                    p.nazwa,
                    fontSize = 12.sp,
                    color = InkMute,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Box(
                modifier = Modifier
                    .clip(RoundedCornerShape(50))
                    .background(AmberBg)
                    .clickable(onClick = onEdytuj)
                    .padding(horizontal = 12.dp, vertical = 6.dp),
            ) {
                Text(
                    iloscZJednostka(p.ilosc, p.unit),
                    fontWeight = FontWeight.Bold,
                    fontSize = 15.sp,
                    color = AmberInk,
                )
            }
            Box(
                modifier = Modifier
                    .size(40.dp)
                    .clip(RoundedCornerShape(10.dp))
                    .clickable(onClick = onUsun),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    WIcons.Close,
                    contentDescription = "Usuń z kartonu",
                    tint = Destructive,
                    modifier = Modifier.size(20.dp),
                )
            }
        }
        if (edytowana) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                WertisTextField(
                    value = wpis,
                    onValueChange = onWpis,
                    placeholder = "ile sztuk (maks ${MAKS_ILOSC_WPISU.toInt()})",
                    keyboardType = KeyboardType.Number,
                    modifier = Modifier.weight(1f),
                    onDone = onZapisz,
                )
                OutlineButton("ZAPISZ") { onZapisz() }
            }
        }
    }
}
