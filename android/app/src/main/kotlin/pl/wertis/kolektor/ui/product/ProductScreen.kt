package pl.wertis.kolektor.ui.product

import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import pl.wertis.kolektor.AppGraph
import pl.wertis.kolektor.core.loc.validateLoc
import pl.wertis.kolektor.core.net.LocAction
import pl.wertis.kolektor.core.net.LocationsInfo
import pl.wertis.kolektor.core.net.MovementEntry
import pl.wertis.kolektor.core.net.SetLocationBody
import pl.wertis.kolektor.core.product.adresHero
import pl.wertis.kolektor.core.recent.RecentEntry
import pl.wertis.kolektor.core.recent.etykietaAdresu
import pl.wertis.kolektor.core.scan.ScanKind
import pl.wertis.kolektor.data.Poll
import pl.wertis.kolektor.data.pollFlow
import pl.wertis.kolektor.net.apiCall
import pl.wertis.kolektor.scan.ScanHandlerEffect
import pl.wertis.kolektor.ui.components.LoadingRow
import pl.wertis.kolektor.ui.components.LocChip
import pl.wertis.kolektor.ui.components.LocState
import pl.wertis.kolektor.ui.components.OutlineButton
import pl.wertis.kolektor.ui.components.WIcons
import pl.wertis.kolektor.ui.product.LocChoice
import pl.wertis.kolektor.ui.product.LocChoiceSheet
import pl.wertis.kolektor.ui.theme.AmberBgSoft
import pl.wertis.kolektor.ui.theme.AmberInk
import pl.wertis.kolektor.ui.theme.AmberLine
import pl.wertis.kolektor.ui.theme.BarlowCond
import pl.wertis.kolektor.ui.theme.BorderCol
import pl.wertis.kolektor.ui.przesuniecie.PrzesuniecieSheet
import pl.wertis.kolektor.ui.theme.CardWhite
import pl.wertis.kolektor.ui.theme.Ink
import pl.wertis.kolektor.ui.theme.InkMute
import pl.wertis.kolektor.ui.theme.ShadowInk

/* ── Karta towaru ───────────────────────────────────────────────────────────
   Jeden ekran bez przewijania: nagłówek odpowiada na codzienne pytanie („ile
   jest i gdzie leży"), pod nim to, co wymaga czynności, a wszystko rzadkie
   siedzi w trzech zwijanych sekcjach.

   Intencja z kolejności skanów: na karcie skan etykiety regału = przenieś TEN
   towar TAM (przy >1 lokalizacjach — arkusz zastąp/dodaj/zastąp jedną);
   skan EAN przechodzi do fallbacku (karta kolejnego towaru).                 */

private const val LOC_LIMIT = 50

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ProductScreen(graph: AppGraph) {
    // przez flow, nie przez pole: bez tego wejście w zamiennik zmienia `curId`,
    // a ekran zostaje na starym towarze (patrz komentarz w AppNavState)
    val id = graph.nav.curIdFlow.collectAsState().value ?: return
    val scope = rememberCoroutineScope()

    /* Posiew z cache: skan przyniósł kartę w odpowiedzi /scan, a powrót
       z zamiennika ogląda kartę sprzed sekundy — jedno i drugie rysuje się
       od razu, podczas gdy odpytywanie dociąga świeżą wersję. */
    val seed = remember(id) { graph.cards.peekCard(id) }
    val poll by remember(id) {
        pollFlow(2000, initial = seed) {
            apiCall { graph.api.product(id) }.also { graph.cards.putCard(it) }
        }
    }.collectAsState(initial = Poll(seed, loading = seed == null))
    /* `null` = jeszcze nie wiem. Historia dochodzi osobnym żądaniem, więc bez
       tego rozróżnienia wiersz HISTORIA wskoczyłby po chwili i przesunął
       sekcje pod nim — czyli cele dotyku pod kciukiem. Posiew z cache
       zachowuje to rozróżnienie: znana historia nie wraca do `null`. */
    val history by produceState<List<MovementEntry>?>(graph.cards.peekHistory(id), id) {
        value = try {
            apiCall { graph.api.history(id) }.entries.also { graph.cards.putHistory(id, it) }
        } catch (_: Exception) {
            value ?: emptyList()
        }
    }
    // znana reguła od razu — walidacja skanu półki nie czeka na sieć
    val locInfo by produceState(graph.locationsRepo.cached()) { value = graph.locationsRepo.get() }

    var chipMenu by remember(id) { mutableStateOf<String?>(null) }
    /* Sekcje zwijane. Klucz `id`, bo wejście w zamiennik to inny towar i inne
       pytanie — rozwinięcie nie ma się za nim wlec. `rememberSaveable`, bo
       obrót ekranu ani odtworzenie procesu nie mają zwijać sekcji, którą ktoś
       właśnie czyta. */
    var otwarte by rememberSaveable(id) { mutableStateOf(setOf<String>()) }
    fun toggle(k: String) { otwarte = if (k in otwarte) otwarte - k else otwarte + k }
    // skan przy wielu lokalizacjach — także ten z trybu przypiętego, który
    // przyprowadził nas na tę kartę właśnie po rozstrzygnięcie
    /* Półka zeskanowana przy towarze mającym ≥2 adresy — wtedy ZASTĄP/DODAJ
       jest realną decyzją człowieka i arkusz otwiera się tutaj, gdzie widać
       wszystkie adresy naraz. */
    var pendingLoc by remember(id) { mutableStateOf<String?>(null) }
    var saving by remember { mutableStateOf(false) }
    /** Otwarte przesunięcie: skąd i ile wolno stamtąd wziąć. */
    var przesun by remember(id) { mutableStateOf<Zrodlo?>(null) }
    /** Arkusz nadania kodu kreskowego (0.37.0). */
    var eanOtwarty by remember(id) { mutableStateOf(false) }
    /** Arkusz dodania zdjęcia kartoteki (0.88.0). */
    var zdjecieOtwarte by remember(id) { mutableStateOf(false) }
    /* Licznik, nie flaga: po zapisie slot ma pobrać zdjęcie od nowa, a drugie
       zdjęcie tej samej kartoteki musi zadziałać tak samo jak pierwsze. */
    var zdjecieOdswiez by remember(id) { mutableStateOf(0) }

    val p = poll.data

    /** Zapis relokacji ze skanu (wspólny zapis — SaveLocation.kt). */
    fun saveLoc(choice: LocChoice) {
        if (saving) return
        saving = true
        scope.launch {
            try {
                saveLocation(graph, id, choice, locInfo)
                pendingLoc = null
            } catch (e: Exception) {
                graph.effects.toast(e.message ?: "Błąd zapisu")
            } finally {
                saving = false
            }
        }
    }

    ScanHandlerEffect { scan ->
        val card = p
        if (card == null || scan.kind != ScanKind.LOC) return@ScanHandlerEffect false
        val err = validateLoc(scan.code, locInfo)
        when {
            err != null -> {
                graph.effects.toast(err)
                graph.feedback.beep(false)
            }
            scan.code in card.locs -> graph.effects.toast("Towar już ma lokalizację ${scan.code}")
            card.locs.size > 1 -> pendingLoc = scan.code
            else -> saveLoc(LocChoice(LocAction.REPLACE, scan.code))
        }
        true
    }

    if (p == null) {
        LoadingRow("Wczytywanie karty…")
        return
    }

    val locStr = p.locs.joinToString(" ")
    val adres = adresHero(p.locs, p.pendingLocs)
    // adres pickingowy siedzi w nagłówku, więc rząd chipów pokazuje resztę
    val chipy = p.locs.drop(1)
    val chipyPending = p.pendingLocs.filter { it.kind == "add" && it.code != adres.kod }

    /* „Ostatnio skanowane" bierze adres z chwili OTWARCIA karty, więc po
       relokacji ekran główny pokazywał adres sprzed zmiany — jeszcze przez
       cztery kolejne otwarcia. Wpis idzie za pastylką nagłówka, czyli za tym,
       co magazynier właśnie widział, i tak samo liczy adres dochodzący
       z kolejki Sfery. Wpisu spoza listy to nie dodaje ani nie przestawia —
       reguła i jej powód siedzą w `:core` (`OstatnioSkanowane.kt`). */
    LaunchedEffect(id, adres.kod, p.name) {
        graph.recent.odswiezWpis(id, etykietaAdresu(adres.kod), p.name)
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        ProductHero(
            p,
            onPrzesunZMgp = { przesun = Zrodlo(null, "MGP", p.mgp.stan - p.mgp.pendingOut) },
            onEan = { eanOtwarty = true },
            zdjecie = {
                ZdjecieKartoteki(
                    graph,
                    p.id,
                    odswiez = zdjecieOdswiez,
                    /* `null` chowa „+". Starszy serwer pola nie wysyła, więc
                       przycisk nie pojawia się tam, gdzie funkcji nie ma. */
                    onDodaj = if (p.mozeDodacZdjecie) ({ zdjecieOtwarte = true }) else null,
                )
            },
        ) {
            /* Pastylka adresu pickingowego. Ograniczona szerokość, żeby długi
               kod nie zepchnął liczby 44 sp — adresy mieszczą się w dziewięciu
               znakach, ale wykaz nie jest gwarancją. */
            Box(Modifier.widthIn(max = 168.dp)) {
                if (adres.kod.isEmpty()) {
                    DodajAdres { graph.nav.openScanLoc() }
                } else {
                    val zmiana = adres.zmiana
                    LocChip(
                        adres.kod,
                        primary = true,
                        state = when {
                            zmiana == null -> LocState.CONFIRMED
                            zmiana.status == "error" -> LocState.FAILED
                            zmiana.kind == "add" -> LocState.ADDING
                            else -> LocState.REMOVING
                        },
                        big = true,
                    ) {
                        /* Adres jeszcze nieudany albo dopiero dochodzący
                           prowadzi w kolejkę: menu z USUŃ dotyczyłoby kodu,
                           którego w Subiekcie nie ma. Potwierdzony otwiera to
                           samo menu, co chipy pod spodem. */
                        if (zmiana?.status == "error" || zmiana?.kind == "add") graph.nav.openQueue()
                        else chipMenu = if (chipMenu == adres.kod) null else adres.kod
                    }
                }
            }
        }

        /* Wejście w dostawę z karty towaru (0.70.0). Dwa kroki, bo takie są
           reguły: dokument trzeba najpierw OTWORZYĆ (`openDelivery` po stronie
           serwera zakłada wiersze rozkładania i melduje pracę), a dopiero
           potem można wskazać w nim pozycję.

           `p.id` to kartoteka — i to jej szukamy na liście, nie identyfikatora
           wiersza. Wiersza jeszcze nie ma w chwili kliknięcia; powstaje razem
           z otwarciem dokumentu, o linijkę wyżej.

           Odmowa serwera (dokument w buforze, cudza praca) idzie w toast, jak
           przy wejściu z listy dostaw — ta sama ścieżka, ten sam komunikat. */
        FaktyCard(p) { d ->
            scope.launch {
                try {
                    val r = apiCall { graph.api.openDelivery(d.dokId) }
                    graph.nav.openDelivery(r.deliveryId, zaznaczTwId = p.id)
                } catch (e: Exception) {
                    graph.effects.toast(e.message ?: "Nie udało się otworzyć dostawy")
                }
            }
        }

        /* Lokalizacje pozostałe — pierwsza siedzi w nagłówku. Przy towarze bez
           ani jednego adresu cały rząd znika: „+ DODAJ" przeniósł się wtedy do
           nagłówka, a licznik pokazywałby „0/50 zn.", czyli liczbę, która
           niczego nie ogranicza. */
        if (adres.kod.isNotEmpty()) Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                chipy.forEach { code ->
                    // lokalizacja potwierdzona, chyba że w kolejce czeka jej usunięcie
                    val zmiana = p.pendingLocs.find { it.code == code }
                    LocChip(
                        code,
                        primary = false,
                        state = when {
                            zmiana == null -> LocState.CONFIRMED
                            zmiana.status == "error" -> LocState.FAILED
                            else -> LocState.REMOVING
                        },
                    ) {
                        if (zmiana?.status == "error") graph.nav.openQueue()
                        else chipMenu = if (chipMenu == code) null else code
                    }
                }
                // lokalizacje DOCHODZĄCE nie są jeszcze w `locs` — bez tego skan
                // wyglądałby, jakby nic nie zrobił
                chipyPending.forEach { zmiana ->
                    LocChip(
                        zmiana.code,
                        primary = false,
                        state = if (zmiana.status == "error") LocState.FAILED else LocState.ADDING,
                    ) { graph.nav.openQueue() }
                }
                /* DOŁOŻENIE ADRESU stoi w rzędzie chipów, bo to operacja NA TEJ
                   LIŚCIE — obok adresów, które zostają. Przeprowadzka (skan
                   półki przy otwartej karcie) nie ma tu swojego przycisku
                   i tak ma być: to jedyne dwie drogi do adresu na tej karcie
                   i różnią się gestem, nie sąsiadującym przyciskiem. */
                Text(
                    "+ DODAJ",
                    fontFamily = BarlowCond,
                    fontWeight = FontWeight.Bold,
                    fontSize = 13.sp,
                    color = AmberInk,
                    modifier = Modifier
                        .clip(RoundedCornerShape(50))
                        .border(1.5.dp, AmberLine, RoundedCornerShape(50))
                        .background(AmberBgSoft)
                        .clickable { graph.nav.openScanLoc() }
                        .padding(horizontal = 12.dp, vertical = 9.dp),
                )
                /* Licznik znaków po prawej stronie rzędu. Pole lokalizacji
                   w Subiekcie ma 50 znaków i jest to twardy błąd zapisu, nie
                   ucięcie — więc liczba musi stać tam, gdzie dokłada się
                   adresy, a nie w osobnym wierszu pod spodem. */
                Box(Modifier.weight(1f), contentAlignment = Alignment.CenterEnd) {
                    Text(
                        "${locStr.length}/$LOC_LIMIT zn.",
                        fontSize = 10.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = if (locStr.length > 42) MaterialTheme.colorScheme.error else InkMute,
                    )
                }
            }
            chipMenu?.let { code ->
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(10.dp))
                        .border(1.dp, BorderCol, RoundedCornerShape(10.dp))
                        .background(CardWhite)
                        .padding(horizontal = 10.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Text("Lokalizacja", fontSize = 13.sp, color = Ink, modifier = Modifier.weight(1f))
                    Text(code, fontSize = 13.sp, fontWeight = FontWeight.Bold, color = Ink)
                    /* PODSTAWOWA = pierwsza z listy (`locs.ts`), czyli ta, którą
                       kolektor pokazuje w nagłówku i po której idzie pobranie.
                       Towar leżący w dwóch miejscach zmienia „główne" wraz
                       z rotacją, a do 0.38.0 jedyną drogą było skasowanie
                       adresu i nadanie go ponownie — czyli utrata informacji,
                       że drugie miejsce w ogóle istnieje.

                       Przycisk pokazuje się WYŁĄCZNIE przy adresie, który
                       podstawowy nie jest: „ustaw jako podstawową" przy już
                       podstawowej byłaby akcją bez skutku. */
                    if (code != adres.kod) {
                        OutlineButton("PODSTAWOWA", enabled = !saving) {
                            scope.launch {
                                try {
                                    apiCall {
                                        graph.api.setLocation(id, SetLocationBody(LocAction.PROMOTE, value = code))
                                    }
                                    graph.queueRepo.refreshNow()
                                    chipMenu = null
                                    graph.feedback.beep(true)
                                } catch (e: Exception) {
                                    graph.effects.toast(e.message ?: "Błąd zapisu")
                                }
                            }
                        }
                    }
                    OutlineButton("USUŃ", danger = true, enabled = !saving) {
                        scope.launch {
                            try {
                                apiCall { graph.api.setLocation(id, SetLocationBody(LocAction.REMOVE, value = code)) }
                                graph.queueRepo.refreshNow()
                                chipMenu = null
                                /* Bez nakładki — chip przechodzi w REMOVING
                                   i sam znika, gdy Subiekt potwierdzi. Ale
                                   stan chipa bierze się z odpowiedzi serwera,
                                   więc dochodzi dopiero z odpytaniem (2 s);
                                   beep potwierdza SAM TAP od razu, żeby ta
                                   sekunda nie wyglądała jak martwy przycisk. */
                                graph.feedback.beep(true)
                            } catch (e: Exception) {
                                graph.effects.toast(e.message ?: "Błąd zapisu")
                            }
                        }
                    }
                    Icon(
                        WIcons.Close,
                        contentDescription = "Zamknij",
                        tint = InkMute,
                        // padding PO clickable = obszar dotyku; ikona zostaje 18 dp,
                        // ale cel rośnie do 48 — krzyżyk 18 dp w rękawicy to loteria
                        modifier = Modifier.clickable { chipMenu = null }.padding(15.dp).size(18.dp),
                    )
                }
            }
        }

        /* Stał tu pełnej szerokości przycisk „ZMIEŃ LOKALIZACJĘ" i wyszedł
           w 0.41.0. Prowadził na ekran skanu, który po zeskanowaniu robił
           DOKŁADNIE to samo, co samo zeskanowanie półki przy otwartej karcie:
           przy jednym adresie zastępował, przy kilku otwierał ten sam arkusz.
           Duplikat najgorszego rodzaju — bo to on był największym elementem
           karty, choć ZASTĄP kasuje istniejący adres, a bezpieczne „+ DODAJ"
           stoi wyżej jako mały chip. Waga na ekranie była odwrócona wobec
           ceny pomyłki.

           Przeprowadzka idzie teraz jedną drogą: skan półki na karcie. */

        HistoriaSekcja(history, "hist" in otwarte) { toggle("hist") }
        MagazynySekcja(p, "mag" in otwarte, { toggle("mag") }) { magId, rola, dostepne ->
            przesun = Zrodlo(magId, rola, dostepne)
        }
        ZamiennikiSekcja(graph, p, "zam" in otwarte, { toggle("zam") }) { row ->
            graph.nav.openProduct(
                row.id,
                RecentEntry(row.id, row.sym, etykietaAdresu(row.locs.firstOrNull()), row.name),
            )
        }
    }

    LocChoiceSheet(
        product = p,
        code = pendingLoc,
        onClose = { pendingLoc = null },
        onPick = ::saveLoc,
    )

    przesun?.let { z ->
        PrzesuniecieSheet(
            graph = graph,
            twId = p.id,
            sym = p.sym,
            name = p.name,
            unit = p.unit,
            magFrom = z.magId,
            magFromRola = z.rola,
            dostepne = z.dostepne,
            onDone = { przesun = null },
            onCancel = { przesun = null },
        )
    }

    if (eanOtwarty) {
        EanSheet(
            graph = graph,
            twId = p.id,
            sym = p.sym,
            nazwa = p.name,
            eanKartoteki = p.ean,
            onClose = { eanOtwarty = false },
            onZapisano = {
                eanOtwarty = false
                /* Pole EAN na karcie pokazuje to, co stoi w SUBIEKCIE, więc
                   zaktualizuje się dopiero po workerze — a skan działa już
                   teraz, przez alias. Komunikat mówi wprost o tej różnicy,
                   zamiast udawać, że kartoteka zmieniła się natychmiast. */
                graph.effects.toast("Kod nadany — skan działa od razu, kartoteka po zapisie")
            },
        )
    }

    if (zdjecieOtwarte) {
        ZdjecieSheet(
            graph = graph,
            twId = p.id,
            sym = p.sym,
            nazwa = p.name,
            onClose = { zdjecieOtwarte = false },
            onZapisano = {
                zdjecieOtwarte = false
                zdjecieOdswiez++
                /* Ta sama różnica co przy kodzie kreskowym: zdjęcie widać na
                   karcie od razu, bo leży w bazie WERTIS, a do kartoteki
                   w Subiekcie wchodzi dopiero po workerze. Komunikat mówi o tym
                   wprost, zamiast udawać, że kartoteka zmieniła się natychmiast. */
                graph.effects.toast("Zdjęcie zapisane — na karcie od razu, w kartotece po zapisie")
            },
        )
    }
}

/** Skąd wychodzi przesunięcie: kafel zna `magId`, kafle ról znają tylko rolę. */
private data class Zrodlo(val magId: Long?, val rola: String?, val dostepne: Double)

/**
 * Pastylka pustego stanu — od razu czynność, nie komunikat.
 *
 * Stoi na miejscu adresu pickingowego, bo tam pada pytanie „gdzie to leży".
 * Odpowiedź „nigdzie" jest u tej firmy zadaniem do wykonania, a nie faktem do
 * przyjęcia: kartoteka bez adresu znaczy, że towar leży gdzieś na hali i nikt
 * poza znalazcą nie wie gdzie. Napis „brak lokalizacji" mówił to samo, tyle że
 * kazał szukać czynności gdzie indziej.
 *
 * Bursztyn, nie grafit: ciemna pastylka jest obietnicą adresu i pusta udawałaby,
 * że towar gdzieś leży. Pełne „+ DODAJ ADRES" zamiast samego „+ DODAJ" z rzędu
 * chipów, bo tam chip stoi wśród adresów i wiadomo, do czego się dokłada — tu
 * nie ma czego dokładać, więc słowo musi to powiedzieć.
 *
 * BRYŁA JEST TA SAMA CO W `LocChip(big = true)` i to nie jest kosmetyka: obie
 * pastylki stoją w tym samym miejscu nagłówka i są tą samą rzeczą widzianą
 * w dwóch stanach. Różniły się cieniem i wysokością wiersza, więc karta towaru
 * bez adresu wyglądała jak inny ekran, a nie jak ta sama karta z pustym polem.
 * Wysokość 52 dp, cień 3 dp, obrys 1,5 dp, wypełnienie 16/12 — wszystko
 * przepisane z `LocChip`.
 *
 * Napis zostaje mniejszy od kodu adresu (17 sp wobec 19 sp) i to jedyna
 * rozmyślna różnica: „+ DODAJ ADRES" ma trzynaście znaków wobec dziewięciu
 * w `A01-02-03`, a pastylka mieści się w 168 dp nagłówka. Przy 19 sp napis
 * zjadłby wielokropek i pastylka mówiłaby „+ DODAJ ADRE…".
 */
@Composable
private fun DodajAdres(onClick: () -> Unit) {
    val shape = RoundedCornerShape(50)
    Row(
        modifier = Modifier
            .shadow(3.dp, shape, clip = false, ambientColor = ShadowInk, spotColor = ShadowInk)
            .clip(shape)
            .border(1.5.dp, AmberLine, shape)
            .background(AmberBgSoft)
            .heightIn(min = 52.dp)
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(7.dp),
    ) {
        Icon(WIcons.Pin, null, tint = AmberInk, modifier = Modifier.size(16.dp))
        Text(
            "+ DODAJ ADRES",
            fontFamily = BarlowCond,
            fontWeight = FontWeight.ExtraBold,
            fontSize = 17.sp,
            color = AmberInk,
            maxLines = 1,
        )
    }
}
