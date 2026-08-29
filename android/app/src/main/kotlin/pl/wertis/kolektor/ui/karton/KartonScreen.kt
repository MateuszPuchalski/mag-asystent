package pl.wertis.kolektor.ui.karton

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
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
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.launch
import pl.wertis.kolektor.AppGraph
import pl.wertis.kolektor.core.karton.FazaKartonu
import pl.wertis.kolektor.core.karton.fazaKartonu
import pl.wertis.kolektor.core.karton.kolejnoscZbierania
import pl.wertis.kolektor.core.nav.Screen
import pl.wertis.kolektor.core.net.DodajDoKartonuBody
import pl.wertis.kolektor.core.net.IloscKartonuBody
import pl.wertis.kolektor.core.net.KoszPozycja
import pl.wertis.kolektor.core.net.KoszView
import pl.wertis.kolektor.core.net.ProductRow
import pl.wertis.kolektor.core.scan.ScanKind
import pl.wertis.kolektor.core.text.MAKS_ILOSC_WPISU
import pl.wertis.kolektor.core.text.formatQty
import pl.wertis.kolektor.core.text.iloscZJednostka
import pl.wertis.kolektor.core.text.iloscZWpisu
import pl.wertis.kolektor.net.apiCall
import pl.wertis.kolektor.scan.ScanHandlerEffect
import pl.wertis.kolektor.ui.components.LoadingRow
import pl.wertis.kolektor.ui.components.LocChip
import pl.wertis.kolektor.ui.components.OutlineButton
import pl.wertis.kolektor.ui.components.PrimaryButton
import pl.wertis.kolektor.ui.components.ProductRowCard
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

     otwarty   → to, co niżej: dokładanie towaru skanem albo z wyszukiwarki,
     zamkniety → `KoszScreen`, bez zmian, bo rozkładanie kartonu i rozkładanie
                 kosza to ta sama praca i ta sama gramatyka skanu.

   WPISYWANIE SZUKA, a nie dodaje w ciemno (0.123.0). Do tej wersji pole
   wysyłało napis na serwer i literówka kończyła się „Nieznany kod" — ta sama
   usterka, którą 0.117.0 naprawiło w otwartej dostawie. Teraz wpis pyta
   `/api/products/search`, a człowiek wybiera z listy, która pokazuje symbol,
   nazwę, PÓŁKI i stan. Dotknięcie wiersza posyła `twId`, więc wybór zrobiony
   wzrokiem nie jest rozwiązywany drugi raz z napisu.

   Skan znaczy JEDNĄ SZTUKĘ i sumuje się na istniejącej pozycji. Tak wygląda
   praca przy pudle: człowiek wyjmuje sztukę po sztuce i nie liczy najpierw
   całości. Liczbę wpisuje się wtedy, gdy ktoś już policzył — sto sztuk to sto
   stuknięć w plus, czyli droga, której nikt nie przejdzie.

   Lista idzie od NAJNOWSZEJ pozycji (`kolejnoscZbierania`), bo jedyne pytanie
   przy zbieraniu brzmi „czy to, co przed chwilą zeskanowałem, weszło".        */

// `debounce` jest wciąż @FlowPreview — ta sama zgoda co w `HomeScreen`
@OptIn(FlowPreview::class)
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
    var wyniki by remember { mutableStateOf<List<ProductRow>>(emptyList()) }
    var przyblizone by remember { mutableStateOf(false) }
    var szuka by remember { mutableStateOf(false) }
    var pytanieOAnulowanie by remember { mutableStateOf(false) }

    /* Wyszukiwarka jedzie do SERWERA, a nie filtruje listy w pamięci.
       `filtrujSzukaniem` z `core/text/Szukanie.kt` obsługuje listę, którą
       kolektor już ma (pozycje dostawy); tu kandydatem jest cała kartoteka —
       3415 pozycji, których nie ma po co ściągać na urządzenie.

       Odbicie 250 ms i `collectLatest` jak w `HomeScreen`: człowiek pisze
       dalej, kiedy pierwsze żądanie jeszcze leci, a liczy się ostatnie. */
    val zapytanie = remember { MutableStateFlow("") }
    LaunchedEffect(Unit) {
        zapytanie.debounce(250).collectLatest { q ->
            val czyste = q.trim()
            if (czyste.isEmpty()) {
                wyniki = emptyList()
                przyblizone = false
                return@collectLatest
            }
            szuka = true
            try {
                val r = apiCall { graph.api.search(czyste) }
                wyniki = r.results
                przyblizone = r.przyblizone
            } catch (_: Exception) {
                // brak sieci — zostaw to, co już widać
            } finally {
                szuka = false
            }
        }
    }

    LaunchedEffect(id, reload) {
        try {
            karton = apiCall { graph.api.kosz(id) }.kosz
        } catch (e: Exception) {
            graph.effects.toast(e.message ?: "Nie udało się wczytać kartonu")
        }
    }

    fun dodaj(body: DodajDoKartonuBody, opis: String) {
        scope.launch {
            try {
                val r = apiCall { graph.api.kartonDodaj(id, body) }
                if (r.nieznany) {
                    graph.feedback.beep(false)
                    graph.effects.toast("Nieznany kod: $opis")
                } else {
                    graph.feedback.beep(true)
                    /* Meldunek podaje ILOŚĆ PO DODANIU, a nie „dodano 1".
                       Przy sumowaniu to jedyna liczba, o którą się tu pyta. */
                    graph.effects.toast("${r.symbol} · ${formatQty(r.ilosc)} w kartonie")
                    wpisKodu = ""
                    wpisIlosci = ""
                    zapytanie.value = ""
                    wyniki = emptyList()
                    przyblizone = false
                    reload++
                }
            } catch (e: Exception) {
                graph.feedback.beep(false)
                graph.effects.toast(e.message ?: "Nie udało się dodać towaru")
            }
        }
    }

    /** Skan i ENTER — napis, który dopiero trzeba rozwiązać; robi to serwer. */
    fun dodajKodem(code: String, ilosc: Double?) {
        val czysty = code.trim()
        if (czysty.isEmpty()) return
        dodaj(DodajDoKartonuBody(code = czysty, ilosc = ilosc), czysty)
    }

    /** Dotknięcie wiersza wyników — wybór człowieka, więc leci `twId`. */
    fun dodajZListy(row: ProductRow) =
        dodaj(DodajDoKartonuBody(twId = row.id, ilosc = iloscZWpisu(wpisIlosci)), row.sym)

    fun anuluj() {
        scope.launch {
            try {
                val r = apiCall { graph.api.kartonAnuluj(id) }
                pytanieOAnulowanie = false
                graph.effects.toast(
                    if (r.usuniety) "Pusty karton usunięty" else "Karton anulowany — biuro go widzi"
                )
                graph.nav.go(Screen.KARTONY)
            } catch (e: Exception) {
                graph.effects.toast(e.message ?: "Nie udało się anulować kartonu")
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
            dodajKodem(scan.code, null)
        }
        true
    }

    if (k == null) {
        LoadingRow("Wczytywanie kartonu…")
        return
    }
    if (fazaKartonu(k.status) != FazaKartonu.ZBIORKA) {
        /* Zatwierdzony karton jest zwykłym koszem do rozłożenia — ten sam
           ekran. ANULUJ zostaje pod nim, bo pudło bywa porzucone także TU:
           ktoś zabrał zawartość ręką albo okazało się, że rozłożył ją kolega
           (decyzja właściciela — anulowanie działa na każdym etapie). */
        Column(Modifier.fillMaxSize()) {
            Box(Modifier.weight(1f)) { KoszScreen(graph) }
            PasekAnulowania(
                // faza zbiórki bierze wcięcie z kolumny wyżej, ta go nie ma
                modifier = Modifier.padding(horizontal = 12.dp),
                pytamy = pytanieOAnulowanie,
                pozycji = k.pozycje.size,
                odlozonych = k.odlozonych,
                onPytaj = { pytanieOAnulowanie = true },
                onNie = { pytanieOAnulowanie = false },
                onTak = { anuluj() },
            )
        }
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
            "Skanuj towar — każdy skan to jedna sztuka. Wpisując, wybierz z listy.",
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
                onValueChange = {
                    wpisKodu = it
                    zapytanie.value = it
                },
                placeholder = "symbol, EAN albo nazwa",
                leadingIcon = WIcons.Search,
                modifier = Modifier.weight(1f),
                /* ENTER bierze PIERWSZY wynik, a przy pustej liście próbuje
                   napisem — ten sam odruch, co na ekranie głównym. */
                onDone = {
                    val pierwszy = wyniki.firstOrNull()
                    if (pierwszy != null) dodajZListy(pierwszy)
                    else dodajKodem(wpisKodu, iloscZWpisu(wpisIlosci))
                },
            )
            WertisTextField(
                value = wpisIlosci,
                onValueChange = { wpisIlosci = it },
                placeholder = "szt.",
                keyboardType = KeyboardType.Number,
                modifier = Modifier.weight(0.45f),
                onDone = { wyniki.firstOrNull()?.let { dodajZListy(it) } },
            )
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
            /* WYNIKI SZUKANIA stoją NAD zawartością pudła, bo to one są teraz
               pytaniem. Wiersz jest tym samym `ProductRowCard`, co na ekranie
               głównym — niesie miniaturę, symbol, nazwę, PÓŁKI i stan, czyli
               wszystko, czego trzeba, żeby wybrać właściwy towar wzrokiem
               zamiast dodawać go w ciemno. */
            if (wyniki.isNotEmpty()) {
                Text(
                    "WYNIKI (${wyniki.size})${if (szuka) " …" else ""}",
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Bold,
                    letterSpacing = 1.2.sp,
                    color = InkSoft,
                )
                /* Furtka na literówki odpala się WYŁĄCZNIE przy zerze trafień
                   dosłownych, więc to zdanie znaczy „nie znalazłem tego, co
                   napisałeś". Przy dokładaniu do pudła warto wtedy popatrzeć
                   uważniej niż zwykle — pomyłka pojedzie na cudzą półkę. */
                if (przyblizone) {
                    Text(
                        "Nie znalazłem dosłownie — to są podobne.",
                        fontSize = 12.sp,
                        color = AmberInk,
                        fontWeight = FontWeight.SemiBold,
                    )
                }
                wyniki.forEach { row -> ProductRowCard(graph, row) { dodajZListy(row) } }
                Text(
                    "ZAWARTOŚĆ KARTONU",
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Bold,
                    letterSpacing = 1.2.sp,
                    color = InkSoft,
                )
            }
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
        PasekAnulowania(
            pytamy = pytanieOAnulowanie,
            pozycji = k.pozycje.size,
            odlozonych = 0,
            onPytaj = { pytanieOAnulowanie = true },
            onNie = { pytanieOAnulowanie = false },
            onTak = { anuluj() },
        )
    }
}

/**
 * ANULUJ KARTON — wyjście dla pudła, którego nikt nie rozłoży.
 *
 * PYTAMY, zanim zrobimy, i pytanie mówi KONKRETNIE, co przepadnie. Anulowanie
 * bywa jedynym wyjściem (pudło otwarte przez pomyłkę), ale bywa też cichym
 * porzuceniem cudzej zbiórki — a te dwie sytuacje wyglądają na ekranie
 * identycznie. Liczba pozycji w pytaniu jest jedyną rzeczą, która je rozdziela.
 *
 * Karton PUSTY znika z bazy bez śladu i pytanie mówi to wprost: kasowanie
 * pomyłki palca nie ma być obwarowane tak samo jak odpisanie ośmiu pozycji.
 */
@Composable
private fun PasekAnulowania(
    modifier: Modifier = Modifier,
    pytamy: Boolean,
    pozycji: Int,
    odlozonych: Int,
    onPytaj: () -> Unit,
    onNie: () -> Unit,
    onTak: () -> Unit,
) {
    Column(
        modifier = modifier.fillMaxWidth().padding(bottom = 10.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        if (!pytamy) {
            OutlineButton("ANULUJ KARTON", danger = true, modifier = Modifier.fillMaxWidth()) { onPytaj() }
            return@Column
        }
        Text(
            when {
                pozycji == 0 -> "Pusty karton zniknie bez śladu. Anulować?"
                odlozonych > 0 ->
                    "$pozycji poz. w kartonie, $odlozonych już na półkach. " +
                        "Odłożone zostają, reszta przepada. Anulować?"
                else -> "$pozycji poz. przepadnie — biuro zobaczy karton jako anulowany. Anulować?"
            },
            fontSize = 13.sp,
            color = Ink,
            fontWeight = FontWeight.SemiBold,
        )
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            OutlineButton("NIE", modifier = Modifier.weight(1f)) { onNie() }
            OutlineButton("TAK, ANULUJ", danger = true, modifier = Modifier.weight(1f)) { onTak() }
        }
    }
}

/**
 * Wiersz zbieranej pozycji: co to jest, gdzie wróci, ile tego jest, i dwa
 * wyjścia z pomyłki.
 *
 * ADRES JEST TU OD 0.123.0 i to jest zgłoszenie z hali. Zbiórka wyglądała jak
 * lista zakupów — symbol, nazwa, liczba — a pierwsze pytanie przy pudle brzmi
 * „na którą półkę to w ogóle wróci". Odpowiedź jechała w tej samej odpowiedzi
 * serwera od pierwszego dnia (`szczegolKosza` liczy adresy dla KAŻDEJ pozycji,
 * także w kartonie otwartym); ekran jej po prostu nie rysował.
 *
 * Chipy są tu WYŁĄCZNIE do czytania — w odróżnieniu od rozkładania nie ma
 * czego nimi wpisywać, bo odkładanie zacznie się dopiero po ZATWIERDŹ.
 *
 * Ilość jest KLIKALNA, bo poprawianie liczby jest tu częstsze niż wszystko
 * inne — ktoś doliczył resztę pudła albo zeskanował dwa razy tę samą sztukę.
 * Kosz na śmieci obok, bo trzeci skan bywa cudzym towarem, którego w tym pudle
 * w ogóle nie ma; przed ZATWIERDŹ wiersz wolno skasować bez śladu, bo nie jest
 * jeszcze zapisem tego, co leży w środku.
 */
@OptIn(ExperimentalLayoutApi::class)
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
        /* Adres pickingowy pierwszy i wyróżniony, za nim reszta półek. Towar
           bez adresu dostaje ZDANIE, nie pustkę: pusty rząd czyta się jak brak
           danych, a to jest fakt do naprawienia przy odkładaniu. */
        val polki = listOfNotNull(p.lokOczekiwana) + p.lokalizacje.filter { it != p.lokOczekiwana }
        if (polki.isEmpty()) {
            Text("bez adresu w kartotece", fontSize = 12.sp, color = InkMute)
        } else {
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                polki.forEachIndexed { i, kod -> LocChip(kod, primary = i == 0) {} }
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
