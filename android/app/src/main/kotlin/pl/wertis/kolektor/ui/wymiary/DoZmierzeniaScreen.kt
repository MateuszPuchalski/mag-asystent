package pl.wertis.kolektor.ui.wymiary

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.Alignment
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextAlign
import pl.wertis.kolektor.ui.theme.BorderCol
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import pl.wertis.kolektor.AppGraph
import pl.wertis.kolektor.core.net.ApiError
import pl.wertis.kolektor.core.net.PozycjaBezWymiarow
import pl.wertis.kolektor.core.net.ScanResult
import pl.wertis.kolektor.core.net.TowarDoPomiaru
import pl.wertis.kolektor.core.scan.ScanKind
import pl.wertis.kolektor.core.wymiary.FiltrWymiarow
import pl.wertis.kolektor.core.wymiary.PorzadekWymiarow
import pl.wertis.kolektor.core.wymiary.braki
import pl.wertis.kolektor.core.wymiary.liczbyWiersza
import pl.wertis.kolektor.core.wymiary.pokazLiczby
import pl.wertis.kolektor.core.wymiary.pustaLista
import pl.wertis.kolektor.core.wymiary.zapytanie
import pl.wertis.kolektor.core.wymiary.zmianaFiltra
import pl.wertis.kolektor.core.wymiary.dolaczStrone
import pl.wertis.kolektor.core.wymiary.doPomiaru
import pl.wertis.kolektor.core.wymiary.indeksRegalu
import pl.wertis.kolektor.core.wymiary.jestWiecej
import pl.wertis.kolektor.core.wymiary.nastepnyWolny
import pl.wertis.kolektor.core.wymiary.wolny
import pl.wertis.kolektor.net.apiCall
import pl.wertis.kolektor.scan.ScanHandlerEffect
import pl.wertis.kolektor.ui.components.LoadingRow
import pl.wertis.kolektor.ui.components.MinTap
import pl.wertis.kolektor.ui.components.OutlineButton
import pl.wertis.kolektor.ui.theme.AmberBg
import pl.wertis.kolektor.ui.theme.AmberInk
import pl.wertis.kolektor.ui.theme.AmberLine
import pl.wertis.kolektor.ui.theme.BarlowCond
import pl.wertis.kolektor.ui.theme.CardBorder
import pl.wertis.kolektor.ui.theme.CardWhite
import pl.wertis.kolektor.ui.theme.Ink
import pl.wertis.kolektor.ui.theme.InkMute
import pl.wertis.kolektor.ui.theme.InkSoft
import pl.wertis.kolektor.ui.theme.Paper
import pl.wertis.kolektor.ui.theme.cardSurface

/* ── Do zmierzenia: towary bez wagi albo wymiaru ────────────────────────────
   Praca seryjna z wagą i miarką, w kolejności OBCHODU regałów. Biuro sortuje
   tę samą listę po sprzedaży, bo siedzi przy biurku. Magazynier idzie alejką,
   więc lista idzie za alejką (ergonomia, punkt 1 i 9).

   W wierszu najpierw ADRES, dużo większy od reszty: po niego człowiek idzie.
   Symbol, nazwa i to, czego brakuje, są drugorzędne (punkt 2).

   PORZĄDEK I FILTRY stoją nad listą jako chipy, nie lista rozwijana: jedno
   dotknięcie zamiast dwóch i cel na rękawicę. Domyślny zostaje obchód
   regałów. Inne porządki dopisują w wierszu sprzedaż i stan, bo to one
   tłumaczą, dlaczego towar stoi wysoko. Wybór żyje w `AppNavState`, więc
   przetrwa zajrzenie do innej zakładki.

   Skan na tym ekranie:
     kod towaru  → formularz pomiaru tego towaru,
     kod regału  → wskazanie pierwszego wolnego towaru z tego regału.
   Nic tu nie pisze do kartoteki skanem — zapis idzie wyłącznie przyciskiem
   w formularzu, po wpisaniu liczb.

   PO ZAPISIE LISTA WRACA I WSKAZUJE NASTĘPNY WOLNY TOWAR, zamiast otwierać
   jego formularz sama. Dotknięć jest tyle samo: następny formularz otwiera
   skan towaru, który i tak bierze się do ręki, żeby go zważyć. Za to skan
   POTWIERDZA, co leży na wadze. Formularz otwarty sam z siebie czekałby na
   towar, którego człowiek mógł nie znaleźć albo zdjąć z innej półki, a liczby
   trafiłyby wtedy do cudzej kartoteki bez śladu (punkt 3, granica reguły). */

@Composable
fun DoZmierzeniaScreen(graph: AppGraph) {
    val scope = rememberCoroutineScope()
    val listState = rememberLazyListState()

    var pozycje by remember { mutableStateOf<List<PozycjaBezWymiarow>>(emptyList()) }
    var razem by remember { mutableStateOf(0) }
    /** Przesunięcie następnej strony: suma wierszy oddanych przez serwer. */
    var offset by remember { mutableStateOf(0) }
    /** `null` = jeszcze nie wiem, czy funkcja działa. */
    var wlaczone by remember { mutableStateOf<Boolean?>(null) }
    var powod by remember { mutableStateOf<String?>(null) }
    var bladListy by remember { mutableStateOf<String?>(null) }
    var ladowanie by remember { mutableStateOf(false) }
    /** Zapisane z tego kolektora — lista serwera dowie się o nich przy przeładowaniu. */
    var zapisane by remember { mutableStateOf(setOf<Long>()) }
    /** Wiersz wskazany: następny do zmierzenia albo trafiony skanem regału. */
    var wskazany by remember { mutableStateOf<Long?>(null) }
    var formularz by remember { mutableStateOf<TowarDoPomiaru?>(null) }
    var filtr by remember { mutableStateOf(graph.nav.filtrWymiarow) }

    suspend fun wczytaj(od: Int) {
        val f = filtr
        val z = f.zapytanie(od)
        ladowanie = true
        try {
            val strona = apiCall {
                graph.api.bezWymiarow(
                    offset = z.offset,
                    sortuj = z.sortuj,
                    naStanie = z.naStanie,
                    sprzedane = z.sprzedane,
                )
            }
            /* Odpowiedź pod wybór, który człowiek już zmienił, wkleiłaby
               stary porządek pod nowy chip. Nowe żądanie jest już w drodze. */
            if (f != filtr) return
            wlaczone = strona.wlaczone
            powod = strona.powod
            razem = strona.razem
            pozycje = if (od == 0) strona.pozycje else dolaczStrone(pozycje, strona.pozycje)
            offset = od + strona.pozycje.size
            bladListy = null
        } catch (e: ApiError) {
            bladListy = e.message ?: "Serwer nie oddał listy"
        } catch (e: Exception) {
            bladListy = "Brak połączenia z serwerem"
        } finally {
            ladowanie = false
        }
    }

    suspend fun przeladuj() {
        zapisane = emptySet()
        wczytaj(0)
        wskazany = nastepnyWolny(pozycje, null, zapisane)?.twId
    }

    LaunchedEffect(Unit) { przeladuj() }

    /** Nowy porządek albo filtr: lista od zera, stara znika od razu. */
    fun zmienFiltr(nowy: FiltrWymiarow) {
        zmianaFiltra(filtr, nowy) ?: return
        filtr = nowy
        graph.nav.filtrWymiarow = nowy
        pozycje = emptyList()
        razem = 0
        offset = 0
        wskazany = null
        scope.launch {
            przeladuj()
            listState.scrollToItem(0)
        }
    }

    /* Wskazany wiersz ma być WIDOCZNY. Podświetlenie poza ekranem jest pamięcią
       urządzenia, której człowiek nie widzi (ergonomia, punkt 2). Indeks +2
       za nagłówkiem i rzędem filtrów. */
    LaunchedEffect(wskazany) {
        val i = pozycje.indexOfFirst { it.twId == wskazany }
        if (i >= 0) listState.animateScrollToItem(i + 2)
    }

    fun otworz(twId: Long) {
        val wiersz = pozycje.find { it.twId == twId }
        if (wiersz != null) {
            if (!wolny(wiersz, zapisane)) {
                graph.feedback.beep(false)
                graph.effects.toast("Pomiar tego towaru czeka w kolejce do Subiekta")
                return
            }
            graph.feedback.beep(true)
            wskazany = twId
            formularz = wiersz.doPomiaru()
            return
        }
        /* Towaru nie ma na wczytanej liście: dalsza strona albo kartoteka,
           która ma już wszystko, a ktoś chce poprawić złą wartość. */
        scope.launch {
            try {
                val w = apiCall { graph.api.wymiaryTowaru(twId) }
                val towar = w.towar
                when {
                    !w.wlaczone || towar == null -> {
                        graph.feedback.beep(false)
                        graph.effects.toast(w.powod ?: "Pomiar wag i wymiarów jest wyłączony")
                    }
                    w.oczekuje || twId in zapisane -> {
                        graph.feedback.beep(false)
                        graph.effects.toast("Pomiar tego towaru czeka w kolejce do Subiekta")
                    }
                    else -> {
                        graph.feedback.beep(true)
                        formularz = towar
                    }
                }
            } catch (e: ApiError) {
                graph.feedback.beep(false)
                graph.effects.toast(if (e.status == 404) "Tego towaru nie ma w Subiekcie" else e.message ?: "Błąd serwera")
            } catch (e: Exception) {
                graph.feedback.beep(false)
                graph.effects.toast("Błąd połączenia z serwerem")
            }
        }
    }

    fun pokazRegal(kod: String) {
        val i = indeksRegalu(pozycje, kod, zapisane)
        if (i < 0) {
            graph.feedback.beep(false)
            graph.effects.toast("Regał $kod: nic do zmierzenia na wczytanej liście")
            return
        }
        graph.feedback.beep(true)
        wskazany = pozycje[i].twId
    }

    ScanHandlerEffect { scan ->
        /* Przy otwartym formularzu skan NIE przełącza towaru: wpisane liczby
           przepadłyby bez słowa. Bierzemy go jednak dla siebie, bo oddany
           dalej otworzyłby kartę towaru spod formularza. */
        if (formularz != null) {
            graph.feedback.beep(false)
            graph.effects.toast("Najpierw zapisz albo anuluj bieżący pomiar")
            return@ScanHandlerEffect true
        }
        if (scan.kind == ScanKind.LOC) {
            pokazRegal(scan.code)
            return@ScanHandlerEffect true
        }
        // ta sama trasa skanu co reszta kolektora — serwer zna aliasy kodów
        scope.launch {
            try {
                when (val r = apiCall { graph.api.scan(scan.code, null, "wymiary") }) {
                    is ScanResult.Product -> {
                        graph.cards.putCard(r.card)
                        otworz(r.card.id)
                    }
                    is ScanResult.Location -> pokazRegal(r.code)
                    is ScanResult.Search -> {
                        graph.feedback.beep(false)
                        graph.effects.toast("Kod pasuje do kilku towarów — zeskanuj kod kreskowy")
                    }
                    is ScanResult.NotFound -> {
                        graph.feedback.beep(false)
                        graph.effects.toast("Nieznany kod kreskowy: ${r.code}")
                    }
                }
            } catch (e: Exception) {
                graph.feedback.beep(false)
                graph.effects.toast("Błąd połączenia z serwerem")
            }
        }
        true
    }

    if (wlaczone == null) {
        if (bladListy != null) {
            Column(Modifier.fillMaxSize().padding(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(bladListy.orEmpty(), color = Ink, fontSize = 15.sp)
                OutlineButton("SPRÓBUJ JESZCZE RAZ", modifier = Modifier.fillMaxWidth(), enabled = !ladowanie) {
                    scope.launch { przeladuj() }
                }
            }
        } else {
            LoadingRow("Wczytywanie listy…")
        }
        return
    }

    if (wlaczone == false) {
        /* Funkcja wyłączona to stan, nie awaria: serwer mówi zdaniem, czego
           brakuje (np. pól własnych w Subiekcie). Pusta lista udawałaby, że
           wszystko jest zmierzone. */
        Column(Modifier.fillMaxSize().padding(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("Pomiar wag i wymiarów jest wyłączony", fontWeight = FontWeight.Bold, fontSize = 17.sp, color = Ink)
            powod?.let { Text(it, fontSize = 14.sp, color = InkSoft) }
        }
        return
    }

    LazyColumn(
        state = listState,
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        item(key = "naglowek") {
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text("Do zmierzenia: $razem", fontSize = 20.sp, fontWeight = FontWeight.Bold, color = Ink)
                Text("Skan towaru otwiera pomiar.", fontSize = 12.sp, color = InkMute)
                bladListy?.let { Text(it, fontSize = 12.sp, color = AmberInk, fontWeight = FontWeight.SemiBold) }
            }
        }
        item(key = "filtry") { FiltryListy(filtr, ::zmienFiltr) }
        if (pozycje.isEmpty()) {
            item(key = "pusto") {
                Text(
                    // pusta lista mówi, dlaczego jest pusta przy tym filtrze
                    if (ladowanie) "Wczytuję…" else pustaLista(filtr),
                    color = InkMute,
                    modifier = Modifier.fillMaxWidth().cardSurface().padding(16.dp),
                )
            }
        }
        val liczby = filtr.pokazLiczby()
        items(pozycje, key = { it.twId }) { p ->
            WierszDoZmierzenia(
                p = p,
                wolny = wolny(p, zapisane),
                wskazany = p.twId == wskazany,
                liczby = if (liczby) liczbyWiersza(p) else null,
            ) { otworz(p.twId) }
        }
        if (jestWiecej(offset, razem)) {
            item(key = "wiecej") {
                OutlineButton(
                    if (ladowanie) "WCZYTUJĘ…" else "WIĘCEJ",
                    modifier = Modifier.fillMaxWidth(),
                    enabled = !ladowanie,
                ) { scope.launch { wczytaj(offset) } }
            }
        }
    }

    formularz?.let { towar ->
        PomiarSheet(
            graph = graph,
            towar = towar,
            onClose = { formularz = null },
            onZapisano = {
                zapisane = zapisane + towar.twId
                formularz = null
                val dalej = nastepnyWolny(pozycje, towar.twId, zapisane)
                if (dalej != null || !jestWiecej(offset, razem)) {
                    wskazany = dalej?.twId
                } else {
                    // koniec wczytanej listy — następny towar leży na dalszej stronie
                    scope.launch {
                        wczytaj(offset)
                        wskazany = nastepnyWolny(pozycje, towar.twId, zapisane)?.twId
                    }
                }
            },
            onWylaczone = {
                formularz = null
                scope.launch { przeladuj() }
            },
        )
    }
}

/**
 * Wiersz listy. Zajęty (pomiar w kolejce) jest wyszarzony i nie reaguje na
 * dotyk: drugi pomiar przed zapisem pierwszego byłby wyścigiem o jedno pole.
 * Wskazany ma bursztynowe tło — „tu idziesz teraz".
 */
@Composable
private fun WierszDoZmierzenia(
    p: PozycjaBezWymiarow,
    wolny: Boolean,
    wskazany: Boolean,
    /** „sprzedano X · stan Y", gdy to one ustalają porządek; `null` = bez. */
    liczby: String?,
    onClick: () -> Unit,
) {
    val tlo = when {
        !wolny -> Paper
        wskazany -> AmberBg
        else -> CardWhite
    }
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .cardSurface(background = tlo, borderColor = if (wskazany && wolny) AmberLine else CardBorder)
            .heightIn(min = MinTap)
            .clickable(enabled = wolny, onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Text(
            p.lokalizacja?.takeIf { it.isNotBlank() } ?: "BEZ ADRESU",
            fontFamily = BarlowCond,
            fontWeight = FontWeight.ExtraBold,
            fontSize = 24.sp,
            color = if (wolny) Ink else InkMute,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Text(
            p.symbol,
            fontWeight = FontWeight.Bold,
            fontSize = 14.sp,
            color = if (wolny) Ink else InkMute,
        )
        liczby?.let { Text(it, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = if (wolny) InkSoft else InkMute) }
        if (p.nazwa.isNotBlank()) {
            Text(
                p.nazwa,
                fontSize = 12.sp,
                color = if (wolny) InkSoft else InkMute,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
        Text(
            if (wolny) "brak: ${braki(p.doPomiaru())}" else "w kolejce",
            fontSize = 12.sp,
            fontWeight = FontWeight.SemiBold,
            color = if (wolny) AmberInk else InkMute,
        )
    }
}

/**
 * Porządek (cztery chipy w rzędzie) i dwa przełączniki filtrów pod spodem.
 *
 * Przy 360 dp chip porządku ma około 79 dp szerokości, przełącznik około
 * 165 dp — oba wyżej niż MinTap. Wybrany ma obrys i znacznik ✓, nie tylko
 * kolor: na słońcu przy bramie bursztyn od bieli bywa nie do odróżnienia
 * (ergonomia, punkt 7).
 */
@Composable
private fun FiltryListy(filtr: FiltrWymiarow, onZmiana: (FiltrWymiarow) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            PorzadekWymiarow.entries.forEach { p ->
                ChipWyboru(p.etykieta, filtr.porzadek == p, Modifier.weight(1f)) {
                    onZmiana(filtr.copy(porzadek = p))
                }
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            ChipWyboru("NA STANIE", filtr.naStanie, Modifier.weight(1f)) {
                onZmiana(filtr.copy(naStanie = !filtr.naStanie))
            }
            ChipWyboru("SPRZEDANE 30 DNI", filtr.sprzedane, Modifier.weight(1f)) {
                onZmiana(filtr.copy(sprzedane = !filtr.sprzedane))
            }
        }
    }
}

@Composable
private fun ChipWyboru(tekst: String, wybrany: Boolean, modifier: Modifier, onClick: () -> Unit) {
    val ksztalt = RoundedCornerShape(10.dp)
    Row(
        modifier = modifier
            .clip(ksztalt)
            .background(if (wybrany) AmberBg else CardWhite)
            .border(if (wybrany) 2.dp else 1.dp, if (wybrany) AmberInk else BorderCol, ksztalt)
            .heightIn(min = MinTap)
            .clickable(onClick = onClick)
            .padding(horizontal = 6.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            if (wybrany) "✓ $tekst" else tekst,
            fontFamily = BarlowCond,
            fontWeight = if (wybrany) FontWeight.ExtraBold else FontWeight.SemiBold,
            // 13 sp: „✓ SPRZEDAŻ" ma się zmieścić w chipie ~79 dp przy 360 dp
            fontSize = 13.sp,
            color = if (wybrany) AmberInk else InkSoft,
            textAlign = TextAlign.Center,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}
