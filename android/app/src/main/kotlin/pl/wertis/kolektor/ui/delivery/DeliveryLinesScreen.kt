package pl.wertis.kolektor.ui.delivery

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import pl.wertis.kolektor.AppGraph
import pl.wertis.kolektor.ui.product.MiniaturaTowaru
import pl.wertis.kolektor.core.delivery.TrybWiersza
import pl.wertis.kolektor.core.delivery.trybWiersza
import pl.wertis.kolektor.core.loc.normalizeLoc
import pl.wertis.kolektor.core.net.DeliveryLineView
import pl.wertis.kolektor.core.net.DeliveryView
import pl.wertis.kolektor.core.net.EanCandidate
import pl.wertis.kolektor.core.net.LocApplyAction
import pl.wertis.kolektor.core.net.PutawayLineBody
import pl.wertis.kolektor.core.net.ScanBody
import pl.wertis.kolektor.core.net.ScanResolution
import pl.wertis.kolektor.core.problem.ProblemType
import pl.wertis.kolektor.core.scan.ScanKind
import pl.wertis.kolektor.core.text.formatQty
import pl.wertis.kolektor.net.apiCall
import pl.wertis.kolektor.scan.ScanHandlerEffect
import pl.wertis.kolektor.ui.przesuniecie.PrzesuniecieSheet
import pl.wertis.kolektor.ui.components.LoadingRow
import pl.wertis.kolektor.ui.components.OutlineButton
import pl.wertis.kolektor.ui.components.PrimaryButton
import pl.wertis.kolektor.ui.components.WIcons
import pl.wertis.kolektor.ui.components.WertisTextField
import pl.wertis.kolektor.ui.theme.Amber
import pl.wertis.kolektor.ui.theme.AmberBg
import pl.wertis.kolektor.ui.theme.AmberBgSoft
import pl.wertis.kolektor.ui.theme.AmberInk
import pl.wertis.kolektor.ui.theme.AmberLine
import pl.wertis.kolektor.ui.theme.BarlowCond
import pl.wertis.kolektor.ui.theme.CardBorder
import pl.wertis.kolektor.ui.theme.CardWhite
import pl.wertis.kolektor.ui.theme.Destructive
import pl.wertis.kolektor.ui.theme.Ink
import pl.wertis.kolektor.ui.theme.InkMute
import pl.wertis.kolektor.ui.theme.InkSoft
import pl.wertis.kolektor.ui.theme.Success
import pl.wertis.kolektor.ui.theme.cardSurface

/* ── Tryb A: rozkładanie faktury zakupu (redesign §4.2–§4.5) ────────────────
   Ścieżka główna to DWA SKANY na linię i zero tapnięć: skan towaru → wiersz
   rozwija się z ilością i lokalizacją docelową → skan etykiety regału → zapis,
   wibracja, wiersz zwija się jako odłożony. Zero dialogu potwierdzającego.

   NIC NA TYM EKRANIE NIE PODMIENIA LISTY. Wcześniej robiło to pięć osobnych
   `return`-ów (karta odkładania, rozjazd lokalizacji, kolizja EAN, wyjątek,
   PIN) i za każdym razem gasło jedyne, po co się tu przychodzi: ile jeszcze
   zostało w kartonie. Teraz rutyna i rozjazd dzieją się W WIERSZU, a rzeczy
   wymagające miejsca (wyjątek ze zdjęciem, wybór przy kolizji EAN) wysuwają
   się od dołu jako arkusz, z listą widoczną pod spodem.

   Lista jest KONTROLĄ KOMPLETNOŚCI, nie kolejką: pozycje bierze się z kartonu
   w takiej kolejności, w jakiej wpadną w rękę, i skanuje. Dlatego kolejność
   wierszy jest stała, a odłożone zwężają się w miejscu zamiast znikać.
   Pozycje BEZ lokalizacji idą na koniec — to SKU wymagające decyzji, nie
   rutyny. (Serwer dalej sortuje po lokalizacji; zniknęły tylko nagłówki
   alejek, bo przy pracy „co wpadnie w rękę" nikt po nich nie nawigował.)    */

@Composable
fun DeliveryLinesScreen(graph: AppGraph) {
    val id = graph.nav.deliveryId ?: return
    val scope = rememberCoroutineScope()
    var reload by remember { mutableStateOf(0) }

    /* Posiew z cache: `reload++` po każdym odłożeniu wymusza świeży odczyt,
       ale stary widok zostaje na ekranie do jego przyjścia — między dwiema
       pozycjami z kartonu nie ma już mignięcia „Wczytywanie…". */
    val view by produceState(graph.cards.peekDelivery(id), id, reload) {
        value = try {
            apiCall { graph.api.delivery(id) }.also { graph.cards.putDelivery(id, it) }
        } catch (_: Exception) {
            value
        }
    }

    /** Linia oczekująca na skan lokalizacji (drugi skan). */
    var active by remember(id) { mutableStateOf<DeliveryLineView?>(null) }
    /** Kolizja EAN — operacja stoi, aż użytkownik wybierze (D7). */
    var conflict by remember(id) { mutableStateOf<List<EanCandidate>?>(null) }
    /** Rozjazd lokalizacji — pytamy PRZED zapisem, nigdy po (§4.3). */
    var mismatch by remember(id) { mutableStateOf<Pair<DeliveryLineView, String>?>(null) }
    /** Zgłoszenie wyjątku; `line` = null → problem całej dostawy (D8). */
    var problemFor by remember(id) { mutableStateOf<DeliveryLineView?>(null) }
    var problemOpen by remember(id) { mutableStateOf(false) }
    /** Typ wstępnie wybrany w arkuszu wyjątku (skrót „INNA ILOŚĆ"). */
    var problemType by remember(id) { mutableStateOf<ProblemType?>(null) }
    var busy by remember { mutableStateOf(false) }
    /** Linia trzymana przez kogoś innego, którą brygadzista chce odebrać (§7). */
    var doOdebrania by remember(id) { mutableStateOf<ScanResolution.Locked?>(null) }
    /** Otwarte przesunięcie stanu na halę (skrót z wiersza kontenera). */
    var przesunFor by remember(id) { mutableStateOf<DeliveryLineView?>(null) }
    /* Magazyn skutku, jeśli nie jest halą — czyli kontener. Serwer podaje tu
       `null` po dostawie krajowej, więc kolektor nie musi znać identyfikatorów
       z konfiguracji, żeby wiedzieć, że nie ma czego przesuwać. */
    val magZrodlowy = view?.sourceMagId

    suspend fun resolveProduct(code: String) {
        try {
            when (val r = apiCall { graph.api.deliveryScan(id, ScanBody(code)) }) {
                is ScanResolution.Line -> {
                    graph.feedback.beep(true)
                    active = r.line
                }
                is ScanResolution.Conflict -> {
                    graph.feedback.beep(false)
                    conflict = r.candidates
                }
                is ScanResolution.OffDocument -> {
                    graph.feedback.beep(false)
                    graph.effects.toast("${r.sym} nie jest w tym dokumencie")
                }
                is ScanResolution.Locked -> {
                    // Domyślna odpowiedź to „idź dalej alejką" — cudzej pracy
                    // się nie odbiera odruchowo. Odebranie jest możliwe dla
                    // brygadzisty i biura, i zawsze zostawia ślad.
                    graph.feedback.beep(false)
                    graph.effects.toast("${r.sym} — pozycję rozkłada ${r.lockedBy}")
                    doOdebrania = r
                }
                is ScanResolution.Unknown -> {
                    graph.feedback.beep(false)
                    graph.effects.toast("Nieznany kod: ${r.code}")
                }
            }
        } catch (e: Exception) {
            graph.effects.toast(e.message ?: "Błąd skanu")
        }
    }

    /** Zapis linii (bez MM). `locAction` = null na ścieżce bez rozjazdu. */
    suspend fun commitPutaway(line: DeliveryLineView, code: String, locAction: LocApplyAction?) {
        if (busy) return
        busy = true
        try {
            apiCall {
                graph.api.deliveryPutaway(
                    id,
                    line.id,
                    PutawayLineBody(code, locAction = locAction),
                )
            }
            graph.feedback.beep(true)
            active = null
            mismatch = null
            reload++
            graph.queueRepo.refreshNow()
            graph.effects.flashSuccess("$code · ${line.sym}")
        } catch (e: Exception) {
            graph.feedback.beep(false)
            graph.effects.toast(e.message ?: "Błąd zapisu")
        } finally {
            busy = false
        }
    }

    /**
     * Drugi skan: lokalizacja. Gdy zeskanowana półka nie zgadza się z kartoteką,
     * zapis CZEKA na decyzję człowieka — serwer nie zgadnie, czy towar
     * przeniesiono, czy leży teraz w dwóch miejscach (§4.3).
     */
    suspend fun putaway(line: DeliveryLineView, code: String) {
        val expected = line.locExpected
        if (!expected.isNullOrBlank() && expected != code) {
            graph.feedback.beep(false)
            mismatch = line to code
            return
        }
        commitPutaway(line, code, locAction = null)
    }

    // router skanów: gdy czekamy na lokalizację — LOC kończy operację;
    // w innym wypadku każdy skan próbuje rozstrzygnąć towar.
    // Przy otwartym pytaniu (rozjazd / wyjątek) skan jest połykany — decyzja
    // człowieka nie może zostać przewinięta przez przypadkowy strzał skanera.
    ScanHandlerEffect { scan ->
        if (mismatch != null || problemOpen) return@ScanHandlerEffect true
        val line = active
        if (line != null && scan.kind != ScanKind.EAN) {
            scope.launch { putaway(line, normalizeLoc(scan.code)) }
        } else {
            scope.launch { resolveProduct(scan.code) }
        }
        true
    }

    val v = view
    if (v == null) {
        LoadingRow("Wczytywanie dostawy…")
        return
    }

    /* Odebranie cudzej linii przed TTL. Do sierpnia 2026 wymagało PIN-u, bo
       plakietkę dawało się pożyczyć razem z tożsamością. Przy haśle rozstrzyga
       sama rola — serwer odmówi magazynierowi, a zdarzenie i tak idzie do
       historii. Pytanie zostaje, bo to jedyne miejsce, w którym jedna osoba
       odbiera pracę drugiej bez jej wiedzy. */
    doOdebrania?.let { l ->
        AlertDialog(
            onDismissRequest = { doOdebrania = null },
            containerColor = CardWhite,
            title = { Text("Odebrać pozycję?", fontWeight = FontWeight.Bold) },
            text = {
                Text(
                    "${l.sym} rozkłada ${l.lockedBy}. Bez tego pozycja zwolni się sama " +
                        "po 30 minutach. Odebranie zostanie zapisane w historii."
                )
            },
            confirmButton = {
                PrimaryButton("ODBIERAM") {
                    scope.launch {
                        try {
                            val r = apiCall { graph.api.forceReleaseLine(id, l.lineId) }
                            doOdebrania = null
                            graph.feedback.beep(true)
                            graph.effects.toast(
                                r.odebrano?.let { "Pozycja odebrana: $it" } ?: "Pozycja była już wolna"
                            )
                            resolveProduct(l.code)
                        } catch (e: Exception) {
                            doOdebrania = null
                            graph.feedback.beep(false)
                            graph.effects.toast(e.message ?: "Odmowa")
                        }
                    }
                }
            },
            dismissButton = { OutlineButton("ZOSTAW") { doOdebrania = null } },
        )
    }

    /** Zwolnienie pozycji: zwinięcie wiersza oddaje lock, zamiast czekać na TTL. */
    fun zwolnij(line: DeliveryLineView) {
        active = null
        mismatch = null
        scope.launch { runCatching { apiCall { graph.api.releaseLine(id, line.id) } } }
    }

    /* KOLEJNOŚĆ WIERSZY JEST STAŁA. Serwer sortuje po lokalizacji i tak zostaje;
       odłożone pozycje zwężają się W MIEJSCU, zamiast znikać albo spadać na dół.
       Powód jest z hali: karton drobnicy to dziesięć pozycji, każda na własną
       półkę, a rozkłada się je w kolejności „co wpadnie w rękę". Lista nie jest
       więc kolejką, tylko kontrolą kompletności — a lista, która przestawia się
       po każdym odłożeniu, do sprawdzania wzrokiem się nie nadaje.

       Jedyne przestawienie, jakie zostaje, to zepchnięcie pozycji BEZ
       LOKALIZACJI na koniec: to nie rutyna, tylko SKU wymagające decyzji. */
    val bezLok = v.lines.filter { it.locExpected == null }
    val uporzadkowane = v.lines.filter { it.locExpected != null } + bezLok
    val pierwszyBezLok = bezLok.firstOrNull()?.id

    /* Rozwinięta pozycja idzie pod górną krawędź. To NIE jest kosmetyka: właśnie
       po to karta odkładania była kiedyś pełnoekranowa — z lokalizacją trzeba
       dojść do regału i czytać ją z odległości ramienia. Przewinięcie pod górę
       zachowuje tę własność, nie gasząc listy.

       Cała szapka jest JEDNYM elementem listy, więc przesunięcie indeksu wynosi
       zawsze 1. Rozbicie jej na osobne elementy wymagałoby liczenia ich tutaj,
       a taki licznik rozjeżdża się po cichu przy pierwszej dołożonej sekcji. */
    val listState = rememberLazyListState()
    val indeksAktywnej = active?.let { a -> uporzadkowane.indexOfFirst { it.id == a.id } } ?: -1
    LaunchedEffect(active?.id) {
        if (indeksAktywnej >= 0) listState.animateScrollToItem(indeksAktywnej + 1)
    }

    LazyColumn(
        state = listState,
        modifier = Modifier.fillMaxSize().padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        item(key = "szapka") {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                // nagłówek dostawy + postęp
                Column(Modifier.fillMaxWidth().cardSurface().padding(horizontal = 12.dp, vertical = 10.dp)) {
                    Text(v.nrPelny, fontFamily = BarlowCond, fontWeight = FontWeight.Bold, fontSize = 16.sp, color = Ink)
                    Text(v.dostawca, fontSize = 12.sp, color = InkSoft, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(top = 6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Box(
                            Modifier.weight(1f).height(6.dp).clip(RoundedCornerShape(50)).background(CardBorder),
                        ) {
                            val frac = if (v.progress.total > 0) v.progress.done.toFloat() / v.progress.total else 0f
                            Box(
                                Modifier.fillMaxWidth(frac).height(6.dp).clip(RoundedCornerShape(50))
                                    .background(if (v.progress.remaining == 0) Success else Amber),
                            )
                        }
                        /* „ZOSTAŁO N" zamiast samego „done/total". Lista jest
                           kontrolą kompletności, więc liczbą, po którą sięga
                           oko, jest ta, ile jeszcze leży w kartonie. */
                        Text(
                            if (v.progress.remaining == 0) "KOMPLET" else "zostało ${v.progress.remaining}",
                            fontFamily = BarlowCond,
                            fontWeight = FontWeight.ExtraBold,
                            fontSize = 17.sp,
                            color = if (v.progress.remaining == 0) Success else Ink,
                        )
                        Text("${v.progress.done}/${v.progress.total}", fontSize = 11.sp, color = InkMute)
                    }
                    // wyjątki na tej dostawie nie mają prawa zniknąć z oczu (D8)
                    if (v.progress.problems > 0) {
                        Text(
                            "${v.progress.problems} ${if (v.progress.problems == 1) "pozycja z problemem" else "pozycje z problemem"}",
                            fontSize = 11.5.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = Destructive,
                            modifier = Modifier.padding(top = 4.dp),
                        )
                    }
                }

                /* Dawniej stało tu „lista jest ułożona wg alejek". Zdanie było
                   prawdziwe (serwer dalej tak sortuje), ale opisywało coś, po
                   czym nikt nie pracuje: pozycje bierze się z kartonu w takiej
                   kolejności, w jakiej wpadną w rękę, i skanuje. */
                Text(
                    "Zeskanuj towar z palety — w dowolnej kolejności",
                    fontSize = 12.sp,
                    color = InkSoft,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth(),
                )

                // problem całej dostawy (np. nieznany kod na palecie, brak miejsca)
                OutlineButton(
                    "ZGŁOŚ PROBLEM DOSTAWY",
                    modifier = Modifier.fillMaxWidth(),
                    leadingIcon = WIcons.Alert,
                    onClick = {
                        problemFor = null
                        problemOpen = true
                    },
                )
            }
        }

        items(uporzadkowane, key = { it.id }) { line ->
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                /* Nagłówek sekcji jedzie WEWNĄTRZ pierwszego wiersza bez
                   lokalizacji, a nie jako osobny element listy — dzięki temu
                   lista pozycji zostaje płaska i indeks przewijania nie musi
                   znać żadnych wtrąceń. */
                if (line.id == pierwszyBezLok) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        modifier = Modifier.padding(top = 6.dp),
                    ) {
                        Icon(WIcons.Alert, null, tint = AmberInk, modifier = Modifier.size(15.dp))
                        Text(
                            "BEZ LOKALIZACJI (${bezLok.size})",
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Bold,
                            letterSpacing = 1.1.sp,
                            color = AmberInk,
                        )
                    }
                }
                LineRow(
                    graph = graph,
                    line = line,
                    tryb = trybWiersza(line.status, aktywna = active?.id == line.id),
                    rozjazd = mismatch?.takeIf { it.first.id == line.id }?.second,
                    onTap = {
                        if (active?.id == line.id) zwolnij(line)
                        else scope.launch { resolveProduct(line.sym) }
                    },
                    onProblem = {
                        problemFor = line
                        problemOpen = true
                    },
                    onPrzesun = magZrodlowy?.let { { przesunFor = line } },
                    onQtyIssue = {
                        problemFor = line
                        // od 0.21.0 „inna ilość" to jedna kategoria z formularza:
                        // magazynier podaje, ile faktycznie przyszło, a serwer
                        // zapisuje przy tym ilość z dokumentu — nikt nie zgaduje,
                        // czy „za mało" znaczyło brak, czy niedowóz
                        problemType = ProblemType.QTY_MISMATCH
                        problemOpen = true
                    },
                    onCancel = { zwolnij(line) },
                    onRozjazd = { action ->
                        mismatch?.let { (l, code) -> scope.launch { commitPutaway(l, code, action) } }
                    },
                    onRozjazdAnuluj = { mismatch = null },
                )
            }
        }
    }

    /* Przesunięcie stanu ma sens tylko dla dostaw, które NIE zaksięgowały się
       wprost na hali — czyli dla kontenerów z MGP. Po fakturze krajowej nie ma
       czego przesuwać, więc przycisku po prostu nie ma. */
    przesunFor?.let { linia ->
        PrzesuniecieSheet(
            graph = graph,
            twId = linia.twId,
            sym = linia.sym,
            name = linia.name,
            unit = "szt",
            magFrom = magZrodlowy,
            dostepne = linia.qtyDoc - linia.qtyDone,
            qtyInit = linia.qtyDoc - linia.qtyDone,
            lineId = linia.id,
            onDone = {
                przesunFor = null
                active = null
                reload++
            },
            onCancel = { przesunFor = null },
        )
    }

    /* Arkusze wysuwają się OD DOŁU, zamiast podmieniać ekran. Wcześniej oba
       robiły `return` przed listą, więc każde pytanie gasiło kontekst pracy —
       a to właśnie na liście widać, ile jeszcze zostało w kartonie. */
    if (problemOpen) {
        ProblemSheet(
            graph = graph,
            deliveryId = id,
            line = problemFor,
            initialType = problemType,
            // numer przesyłki pytamy RAZ na dostawę — jeśli już go zapisano,
            // arkusz o niego nie pyta, bo przesyłka jest jedna
            nrPrzesylkiZapisany = view?.nrPrzesylki,
            onDone = {
                problemOpen = false
                problemFor = null
                problemType = null
                active = null
                reload++
            },
            onCancel = {
                problemOpen = false
                problemFor = null
                problemType = null
            },
        )
    }

    // kolizja EAN — operacja stoi, aplikacja nigdy nie wybiera pierwszego (D7)
    conflict?.let { candidates ->
        EanConflictSheet(
            graph = graph,
            candidates = candidates,
            onPick = { c ->
                conflict = null
                scope.launch { resolveProduct(c.sym) } // symbol jest jednoznaczny
            },
            onCancel = { conflict = null },
        )
    }
}

/**
 * Wiersz pozycji — i, po rozwinięciu, całe odkładanie tej pozycji.
 *
 * DAWNIEJ ODKŁADANIE BYŁO OSOBNYM PEŁNYM EKRANEM (`PutawayCard`) wstawianym
 * przez `return` przed listą. Znikała wtedy jedyna rzecz, po którą się na tę
 * listę przychodzi: ile jeszcze zostało w kartonie. Teraz panel wisi pod
 * wierszem, w tej samej karcie, a lista zostaje pod spodem.
 *
 * Wielkie cyfry zostają — z lokalizacją idzie się do regału i czyta ją
 * z odległości ramienia. Utrzymuje je przewinięcie rozwiniętego wiersza pod
 * górną krawędź (`animateScrollToItem` w ekranie).
 */
@Composable
private fun LineRow(
    graph: AppGraph,
    line: DeliveryLineView,
    tryb: TrybWiersza,
    /** Zeskanowana półka niezgodna z kartoteką — decyzja zapada TU (§4.3). */
    rozjazd: String?,
    onTap: () -> Unit,
    onProblem: () -> Unit,
    onQtyIssue: () -> Unit,
    onPrzesun: (() -> Unit)?,
    onCancel: () -> Unit,
    onRozjazd: (LocApplyAction) -> Unit,
    onRozjazdAnuluj: () -> Unit,
) {
    val problem = tryb == TrybWiersza.PROBLEM
    val zwiniety = tryb == TrybWiersza.ZWINIETY
    val rozwiniety = tryb == TrybWiersza.ROZWINIETY

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .cardSurface(
                background = if (rozwiniety) AmberBgSoft else CardWhite,
                borderColor = if (rozwiniety) AmberLine else CardBorder,
            )
            .clickable(onClick = onTap),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                // zwinięty pasek jest o połowę niższy — dziesięć pozycji drobnicy
                // ma się zmieścić na ekranie bez przewijania
                .heightIn(min = if (zwiniety) 34.dp else 52.dp)
                .padding(horizontal = 12.dp, vertical = if (zwiniety) 4.dp else 9.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Icon(
                when {
                    problem -> WIcons.Alert
                    zwiniety -> WIcons.Check
                    else -> WIcons.Box
                },
                contentDescription = null,
                tint = when {
                    problem -> Destructive
                    zwiniety -> Success
                    else -> InkMute
                },
                modifier = Modifier.size(if (zwiniety) 14.dp else 18.dp),
            )
            /* Miniatura W PASKU, po lewej stronie symbolu — zgłoszenie
               z magazynu. Rozwinięty wiersz ma już swoją (56 dp, w miejscu
               pastylki), a decyzja „czy to ten towar" zapada WCZEŚNIEJ:
               przy szukaniu pozycji wzrokiem po liście, zanim ręka sięgnie.

               Wiersz zwinięty jej nie dostaje. Pozycja jest odłożona, więc
               rozpoznawanie towaru nic już nie wnosi, a pasek jest o połowę
               niższy właśnie po to, żeby dziesięć pozycji drobnicy zmieściło
               się na ekranie.

               Ikona stanu zostaje na swoim miejscu: mówi „zrobione" albo
               „zgłoszony problem", czyli coś innego niż zdjęcie. Podmiana
               zabrałaby ostrzeżenie z wiersza. */
            if (!zwiniety && !rozwiniety) MiniaturaTowaru(graph, line.twId, 36.dp)
            Column(Modifier.weight(1f)) {
                Text(
                    line.sym,
                    fontFamily = BarlowCond,
                    fontWeight = FontWeight.Bold,
                    fontSize = if (zwiniety) 13.sp else 15.sp,
                    color = if (zwiniety) InkMute else Ink,
                    textDecoration = if (zwiniety) TextDecoration.LineThrough else null,
                )
                // Nazwa i metadane znikają przy zwijaniu; symbol zostaje, bo to
                // po nim magazynier rozpoznaje towar przy regale.
                if (!zwiniety) {
                    Text(line.name, fontSize = 12.sp, color = InkSoft, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(
                        if (problem) {
                            "ZGŁOSZONY PROBLEM · ${formatQty(line.qtyDoc)} szt"
                        } else {
                            "${formatQty(line.qtyDoc)} szt" +
                                if (line.status == "partial") " · odłożono ${formatQty(line.qtyDone)}" else ""
                        },
                        fontSize = 11.sp,
                        fontWeight = if (problem) FontWeight.Bold else FontWeight.Normal,
                        color = if (problem) Destructive else InkMute,
                    )
                }
            }
            /* LOKALIZACJA JAKO PASTYLKA, nie jako fragment linijki metadanych.
               Każda pozycja drobnicy jedzie na własną półkę, więc to jest ta
               informacja, po którą sięga oko — a nagłówki alejek, które kiedyś
               ją dublowały, zniknęły.

               Rozwinięty wiersz wymienia pastylkę na zdjęcie: adres i tak
               krzyczy 28 sp w panelu odkładania niżej, a wątpliwość, którą
               zdjęcie rozstrzyga („czy to na pewno TEN towar?"), pojawia się
               dokładnie w chwili brania kartonu do ręki. */
            if (!rozwiniety) LokPastylka(line.locExpected, przygaszona = zwiniety)
            else MiniaturaTowaru(graph, line.twId, 56.dp)
        }

        if (rozwiniety) {
            if (rozjazd != null) {
                RozjazdPanel(
                    oczekiwana = line.locExpected ?: "—",
                    zeskanowana = rozjazd,
                    onPick = onRozjazd,
                    onCancel = onRozjazdAnuluj,
                )
            } else {
                PanelOdkladania(
                    line = line,
                    onProblem = onProblem,
                    onQtyIssue = onQtyIssue,
                    onPrzesun = onPrzesun,
                    onCancel = onCancel,
                )
            }
        }
    }
}

/** Docelowa półka pozycji; brak adresu jest wyróżniony, bo wymaga decyzji. */
@Composable
private fun LokPastylka(code: String?, przygaszona: Boolean) {
    val brak = code == null
    val wyroznij = brak && !przygaszona
    Text(
        code ?: "BRAK",
        fontFamily = BarlowCond,
        fontWeight = FontWeight.ExtraBold,
        fontSize = if (przygaszona) 12.sp else 15.sp,
        color = when {
            przygaszona -> InkMute
            brak -> AmberInk
            else -> Ink
        },
        modifier = Modifier
            .clip(RoundedCornerShape(50))
            .border(1.5.dp, if (wyroznij) AmberLine else CardBorder, RoundedCornerShape(50))
            .background(if (wyroznij) AmberBg else CardWhite)
            .padding(horizontal = 10.dp, vertical = 4.dp),
    )
}

/** Zawartość rozwiniętego wiersza: dokąd i ile, plus wyjścia awaryjne. */
@Composable
private fun PanelOdkladania(
    line: DeliveryLineView,
    onProblem: () -> Unit,
    onQtyIssue: () -> Unit,
    /** null = dostawa księgowana wprost na halę, nie ma czego przesuwać. */
    onPrzesun: (() -> Unit)?,
    onCancel: () -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp).padding(bottom = 12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text(
                "${formatQty(line.qtyDoc - line.qtyDone)} szt",
                fontFamily = BarlowCond,
                fontWeight = FontWeight.ExtraBold,
                fontSize = 32.sp,
                color = Ink,
            )
            Text(
                "→ ${line.locExpected ?: "BRAK LOKALIZACJI"}",
                fontFamily = BarlowCond,
                fontWeight = FontWeight.ExtraBold,
                fontSize = 28.sp,
                color = AmberInk,
                modifier = Modifier.weight(1f),
            )
        }
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Icon(WIcons.Pin, null, tint = InkSoft, modifier = Modifier.size(18.dp))
            Text("zeskanuj etykietę lokalizacji", fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = InkSoft)
        }
        // Rozkładanie JEST sprawdzaniem faktury i liczy się KAŻDĄ pozycję, więc
        // rozbieżność ilościowa to najczęstszy wyjątek — zasługuje na własny
        // przycisk, a nie na szukanie kafla wśród pięciu kategorii.
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
            OutlineButton("INNA ILOŚĆ", modifier = Modifier.weight(1f), onClick = onQtyIssue)
            OutlineButton("PROBLEM", modifier = Modifier.weight(1f), danger = true, onClick = onProblem)
        }
        /* Skrót dla kontenera: dostawa na MGP zostawia po odłożeniu adresów
           jeszcze przesunięcie stanu na halę. Bez tego przycisku trzeba by je
           robić z karty towaru, pozycja po pozycji. Po dostawie księgowanej
           wprost na MAG nie ma czego przesuwać i przycisku nie ma. */
        onPrzesun?.let {
            OutlineButton("PRZESUŃ NA HALĘ", modifier = Modifier.fillMaxWidth(), onClick = it)
        }
        OutlineButton("ANULUJ", modifier = Modifier.fillMaxWidth(), onClick = onCancel)
    }
}

/**
 * Rozjazd lokalizacji (§4.3) — decyduje magazynier, nie serwer.
 *
 * Siedzi w rozwiniętym wierszu, bo to ciąg dalszy TEJ SAMEJ operacji na TEJ
 * SAMEJ pozycji; osobny pełny ekran kazał człowiekowi odpowiedzieć na pytanie
 * o towar, którego w tym momencie już nie widział.
 */
@Composable
private fun RozjazdPanel(
    oczekiwana: String,
    zeskanowana: String,
    onPick: (LocApplyAction) -> Unit,
    onCancel: () -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp).padding(bottom = 12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Icon(WIcons.Alert, null, tint = Destructive, modifier = Modifier.size(18.dp))
            Text("Inna półka niż w kartotece", fontWeight = FontWeight.Bold, fontSize = 15.sp, color = Ink)
        }
        Text("kartoteka: $oczekiwana · zeskanowano: $zeskanowana", fontSize = 12.sp, color = InkSoft)
        OutlineButton("PRZENIESIONY — ZAMIEŃ", modifier = Modifier.fillMaxWidth(), tall = true) {
            onPick(LocApplyAction.REPLACE)
        }
        OutlineButton("LEŻY W OBU — DODAJ", modifier = Modifier.fillMaxWidth(), tall = true) {
            onPick(LocApplyAction.ADD)
        }
        OutlineButton("ANULUJ", modifier = Modifier.fillMaxWidth(), onClick = onCancel)
    }
}

/**
 * Kolizja EAN — operacja stoi, aplikacja nigdy nie wybiera pierwszego (D7).
 *
 * Arkusz od dołu, nie pełny ekran: lista pozycji ma zostać widoczna, bo to na
 * niej widać, który z kandydatów w ogóle jest w tym dokumencie.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun EanConflictSheet(
    graph: AppGraph,
    candidates: List<EanCandidate>,
    onPick: (EanCandidate) -> Unit,
    onCancel: () -> Unit,
) {
    ModalBottomSheet(onDismissRequest = onCancel, containerColor = CardWhite) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 14.dp)
            .padding(bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Icon(WIcons.Alert, null, tint = Destructive, modifier = Modifier.size(20.dp))
            Text(
                "Kod wskazuje ${candidates.size} towary",
                fontFamily = BarlowCond,
                fontWeight = FontWeight.Bold,
                fontSize = 18.sp,
                color = Ink,
            )
        }
        Text("Wybierz właściwy — aplikacja nie zgaduje.", fontSize = 13.sp, color = InkSoft)

        candidates.forEach { c ->
            // zdjęcie obok kandydata — dokładnie tu rozstrzyga się „który to
            // towar", a fotografia odpowiada szybciej niż porównywanie symboli
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .cardSurface(
                        background = if (c.inDocument) AmberBg else CardWhite,
                        borderColor = if (c.inDocument) AmberLine else CardBorder,
                    )
                    .clickable { onPick(c) }
                    .padding(12.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                MiniaturaTowaru(graph, c.twId, 56.dp)
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(c.sym, fontFamily = BarlowCond, fontWeight = FontWeight.Bold, fontSize = 16.sp, color = Ink)
                    Text(c.name, fontSize = 12.5.sp, color = InkSoft, maxLines = 2)
                    Text(
                        if (c.inDocument) {
                            "w dokumencie: ${formatQty(c.qtyDoc ?: 0.0)} szt → ${c.locExpected ?: "—"}"
                        } else {
                            "spoza dokumentu → ${c.locExpected ?: "—"}"
                        },
                        fontSize = 11.5.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = if (c.inDocument) AmberInk else InkMute,
                    )
                }
            }
        }

        OutlineButton("ANULUJ", modifier = Modifier.fillMaxWidth(), onClick = onCancel)
    }
    }
}
