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
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
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
import pl.wertis.kolektor.ui.product.EanSheet
import pl.wertis.kolektor.ui.product.MiniaturaTowaru
import pl.wertis.kolektor.core.delivery.StatusLinii
import pl.wertis.kolektor.core.delivery.TrybWiersza
import pl.wertis.kolektor.core.delivery.adresWiersza
import pl.wertis.kolektor.core.delivery.czekaBezLokalizacji
import pl.wertis.kolektor.core.delivery.uporzadkujPozycje
import pl.wertis.kolektor.core.delivery.trybWiersza
import pl.wertis.kolektor.core.loc.normalizeLoc
import pl.wertis.kolektor.core.loc.validateLoc
import pl.wertis.kolektor.core.net.ApiError
import pl.wertis.kolektor.core.net.KorektaBody
import pl.wertis.kolektor.core.net.LocationsInfo
import pl.wertis.kolektor.core.offline.PendingOp
import pl.wertis.kolektor.core.offline.PutawayOp
import pl.wertis.kolektor.core.session.userId
import pl.wertis.kolektor.core.net.DeliveryLineView
import pl.wertis.kolektor.core.net.DeliveryView
import pl.wertis.kolektor.core.net.EanCandidate
import pl.wertis.kolektor.core.net.LocApplyAction
import pl.wertis.kolektor.core.net.PutawayLineBody
import pl.wertis.kolektor.core.net.ScanBody
import pl.wertis.kolektor.core.net.NotatkaDostawy
import pl.wertis.kolektor.core.net.OdpowiedzBody
import pl.wertis.kolektor.core.net.ScanResolution
import pl.wertis.kolektor.core.net.ZakonczenieDostawy
import pl.wertis.kolektor.core.problem.ProblemType
import pl.wertis.kolektor.core.scan.ScanKind
import pl.wertis.kolektor.core.text.formatQty
import pl.wertis.kolektor.core.text.iloscZJednostka
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
import pl.wertis.kolektor.ui.theme.AmberDark
import pl.wertis.kolektor.ui.theme.AmberInk
import pl.wertis.kolektor.ui.theme.AmberLine
import pl.wertis.kolektor.ui.theme.BarlowCond
import pl.wertis.kolektor.ui.theme.CardBorder
import pl.wertis.kolektor.ui.theme.Muted
import pl.wertis.kolektor.ui.theme.CardWhite
import pl.wertis.kolektor.ui.theme.Destructive
import pl.wertis.kolektor.ui.theme.Ink
import pl.wertis.kolektor.ui.theme.InkMute
import pl.wertis.kolektor.ui.theme.InkSoft
import pl.wertis.kolektor.ui.theme.Paper
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

    // reguła walidacji kodu półki — do ręcznego wpisu przy zniszczonej etykiecie
    val locInfo by produceState(graph.locationsRepo.cached()) { value = graph.locationsRepo.get() }

    /** Notatka, na którą właśnie odpowiadamy — `null` = arkusz zamknięty. */
    var notatkaOtwarta by remember(id) { mutableStateOf<NotatkaDostawy?>(null) }

    /** Otwarte podsumowanie zakończenia — `null` = arkusz zamknięty. */
    var zakonczenie by remember(id) { mutableStateOf<ZakonczenieDostawy?>(null) }

    /** Pozycja, której ilość odłożoną właśnie poprawiamy (0.45.0). */
    var korektaDla by remember(id) { mutableStateOf<DeliveryLineView?>(null) }

    /** Filtr listy pozycji — patrz komentarz przy `widoczne`. */
    var szukane by rememberSaveable(id) { mutableStateOf("") }

    /** Linia oczekująca na skan lokalizacji (drugi skan). */
    var active by remember(id) { mutableStateOf<DeliveryLineView?>(null) }
    /**
     * Ile sztuk z otwartej pozycji idzie na półkę. `null` = cała reszta.
     *
     * Trzy z dziesięciu leżą na wierzchu kartonu, siedem pod spodem — i do
     * 0.42.0 nie było na to uczciwej odpowiedzi. Skan półki zamykał CAŁĄ
     * pozycję, więc zostawało kłamstwo („odłożone") albo wyjątek „zła ilość",
     * czyli reklamacja do dostawcy o towarze, który przyjechał w komplecie.
     * Serwer liczył częściowe odłożenia od zawsze (`putawayLine` przyjmuje
     * `qty` i sam nadaje status `partial`) — brakowało wyłącznie tego pola.
     *
     * Zeruje się razem z `active`: ilość należy do JEDNEJ pozycji i przeniesiona
     * na następną byłaby cichą pomyłką co do ilości.
     */
    var czesc by remember(id) { mutableStateOf<Double?>(null) }
    /** Kolizja EAN — operacja stoi, aż użytkownik wybierze (D7). */
    var conflict by remember(id) { mutableStateOf<List<EanCandidate>?>(null) }
    /** Rozjazd lokalizacji — pytamy PRZED zapisem, nigdy po (§4.3). */
    var mismatch by remember(id) { mutableStateOf<Pair<DeliveryLineView, String>?>(null) }
    /** Czy kod w `mismatch` był wpisany z ręki — do raportu etykiet. */
    var mismatchReczna by remember(id) { mutableStateOf(false) }
    /* Pamięć decyzji rozjazdu W TEJ dostawie, per para oczekiwana→zeskanowana.
       Dziesięć pozycji z jednego kartonu odłożonych na tę samą „inną" półkę
       pytało dziesięć razy o to samo — identyczna odpowiedź przestaje być
       decyzją, a staje się przeszkodą w rytmie. Powtórka idzie automatem
       Z TOASTEM (człowiek widzi, co się stało), inna para pyta normalnie.
       Pamięć umiera z dostawą — to decyzja o TYM kartonie, nie reguła. */
    val rozjazdPamiec = remember(id) { mutableStateMapOf<Pair<String, String>, LocApplyAction>() }
    /* Pole ręcznego wpisu otwarte per DOSTAWA, nie per pozycja: seria przy
       zniszczonych etykietach nie wymaga ponownego tapnięcia co pozycję. */
    var manualOpen by remember(id) { mutableStateOf(false) }
    /* Ostatni kod, którego kartoteka nie zna. Trzymany PER DOSTAWA, bo tak
       wygląda ta sytuacja: karton z nieczytelną albo brakującą etykietą leży na
       palecie i człowiek szuka jego pozycji na liście. Kod przeżywa to szukanie,
       żeby dało się go nadać, gdy pozycja się znajdzie. */
    var nieznanyKod by remember(id) { mutableStateOf<String?>(null) }
    /** Otwarty arkusz nadania kodu — dla której pozycji. */
    var eanDla by remember(id) { mutableStateOf<DeliveryLineView?>(null) }
    /** Zgłoszenie wyjątku; `line` = null → problem całej dostawy (D8). */
    var problemFor by remember(id) { mutableStateOf<DeliveryLineView?>(null) }
    var problemOpen by remember(id) { mutableStateOf(false) }
    /** Typ wstępnie wybrany w arkuszu wyjątku (skrót „INNA ILOŚĆ"). */
    var problemType by remember(id) { mutableStateOf<ProblemType?>(null) }
    var busy by remember { mutableStateOf(false) }
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
                    czesc = null
                }
                is ScanResolution.Conflict -> {
                    graph.feedback.beep(false)
                    conflict = r.candidates
                }
                is ScanResolution.OffDocument -> {
                    graph.feedback.beep(false)
                    graph.effects.toast("${r.sym} nie jest w tym dokumencie")
                }
                is ScanResolution.Unknown -> {
                    graph.feedback.beep(false)
                    /* Nieznany kod ZAPAMIĘTUJEMY (0.37.0). Człowiek stoi
                       z kartonem, którego kartoteka nie zna, i to jest jedyny
                       moment, w którym da się ten kod nadać — potem zostanie
                       tylko wspomnienie. Rozwinięcie pozycji z listy pokaże
                       przycisk z tym właśnie kodem.

                       Druga połowa zdania zostaje: nieczytelna etykieta TOWARU
                       nie zatrzymuje pracy, bo wybór z listy robi to samo co
                       skan. */
                    nieznanyKod = r.code
                    graph.effects.toast(
                        "Nieznany kod: ${r.code} — dotknij pozycji na liście, aby ją wybrać albo nadać mu ten kod"
                    )
                }
            }
        } catch (e: Exception) {
            graph.effects.toast(e.message ?: "Błąd skanu")
        }
    }

    /**
     * Zapis linii (bez MM). `locAction` = null na ścieżce bez rozjazdu.
     *
     * Przez bufor offline: rozkładanie to najdłuższa nieprzerwana praca na
     * kolektorze i dzieje się także w martwych punktach hali — dziura Wi-Fi
     * nie może gubić policzonej pozycji ani wyrzucać człowieka z rytmu.
     * Błędy SERWERA (walidacja, zajęta linia) dalej wracają do UI od razu —
     * buforuje się wyłącznie brak sieci, jak przy zmianie lokalizacji.
     */
    suspend fun commitPutaway(
        line: DeliveryLineView,
        code: String,
        locAction: LocApplyAction?,
        recznie: Boolean = false,
    ) {
        if (busy) return
        busy = true
        /* Ile sztuk idzie na półkę. `null` w polu znaczy „cała reszta" i tak
           właśnie rozumie to serwer, więc nie podstawiamy tu liczby — pusta
           wartość niesie intencję, a wyliczona zamrażałaby ilość z chwili
           otwarcia panelu. */
        val zostalo = line.qtyDoc - line.qtyDone
        val ile = czesc?.coerceIn(1.0, zostalo)
        try {
            val res = graph.offlineQueue.runOrBuffer(
                kind = PendingOp.OpKind.PUTAWAY,
                user = graph.session.currentUser,
                userRef = graph.session.state.value.userId,
                productId = line.twId,
                putaway = PutawayOp(
                    deliveryId = id,
                    lineId = line.id,
                    body = PutawayLineBody(
                        code,
                        qty = ile,
                        locAction = locAction,
                        recznie = recznie.takeIf { it },
                    ),
                ),
            )
            // sygnał ZAPISU (dwa tony), nie wyboru — pozycja odłożona, idź dalej
            graph.feedback.zapis()
            active = null
            czesc = null
            mismatch = null
            if (res.offline) {
                /* Bez sieci świeży odczyt nie przyjdzie, a lista musi iść
                   dalej — pozycję odhaczamy w kopii widoku z cache, którą
                   `reload++` zaraz poda jako posiew. Serwer i tak jest
                   ostatecznym arbitrem: operacja doleci z bufora, a odrzucona
                   wróci toastem i meldunkiem, jak każda inna z bufora. */
                graph.cards.peekDelivery(id)?.let { v ->
                    /* Odhaczamy DOKŁADNIE tyle, ile poszło na półkę. Do 0.42.0
                       stało tu `qtyDoc`, czyli bufor zamykał całą pozycję nawet
                       przy odłożeniu trzech sztuk z dziesięciu — i reszta partii
                       znikała z listy pracy do czasu odpowiedzi serwera. */
                    val zrobione = (line.qtyDone + (ile ?: zostalo)).coerceAtMost(line.qtyDoc)
                    graph.cards.putDelivery(id, v.copy(
                        lines = v.lines.map {
                            if (it.id == line.id) {
                                it.copy(
                                    qtyDone = zrobione,
                                    status = if (zrobione >= line.qtyDoc) "done" else "partial",
                                    locActual = code,
                                )
                            } else it
                        },
                    ))
                }
                graph.effects.toast("Zapisano lokalnie · $code — czeka na sieć")
            }
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
    suspend fun putaway(line: DeliveryLineView, code: String, recznie: Boolean = false) {
        val expected = line.locExpected
        if (!expected.isNullOrBlank() && expected != code) {
            val zapamietana = rozjazdPamiec[expected to code]
            if (zapamietana != null) {
                graph.effects.toast(
                    "Rozjazd jak poprzednio: " +
                        if (zapamietana == LocApplyAction.REPLACE) "ZAMIEŃ" else "DODAJ"
                )
                commitPutaway(line, code, zapamietana, recznie = recznie)
                return
            }
            graph.feedback.beep(false)
            // pochodzenie kodu przeżywa pytanie o rozjazd — inaczej ręczny
            // wpis z inną półką wypadałby z raportu etykiet
            mismatchReczna = recznie
            mismatch = line to code
            return
        }
        commitPutaway(line, code, locAction = null, recznie = recznie)
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

    /* Zwinięcie wiersza. Od 0.47.0 jest to czynność WYŁĄCZNIE ekranowa: skan
       nie zajmuje już pozycji, więc nie ma czego oddawać serwerowi. Funkcja
       zostaje, bo zamykanie panelu wygląda tak samo w pięciu miejscach. */
    fun zwolnij(@Suppress("UNUSED_PARAMETER") line: DeliveryLineView) {
        active = null
        czesc = null
        mismatch = null
    }

    /* Do zrobienia na górze, bez lokalizacji pośrodku, ODŁOŻONE NA DOLE.
       Reguła i powód jej odwrócenia (do 0.35.0 odłożone zostawały w miejscu)
       siedzą w :core — razem z zabezpieczeniem, że pozycja z PROBLEMEM na dół
       nie schodzi, bo czeka na decyzję (D8).

       Kolejność alejkowa z serwera przeżywa sortowanie, bo jest stabilne —
       trasa przez halę się nie zmienia. */
    /* Szukanie po symbolu i nazwie. Droga podstawowa to nadal SKAN — filtr
       jest dla kartonu, którego kod nie chce zejść: zdarty, zalany, zaklejony
       taśmą. Bez niego jedynym wyjściem było przewijanie trzydziestu pozycji
       kciukiem w rękawicy.

       Filtruje tylko WIDOK. Kolejność alejkowa, sekcja „bez lokalizacji"
       i liczniki postępu liczą się z pełnej listy — inaczej „7 z 10" zmieniałoby
       się przy pisaniu w polu, a to jest stan dostawy, nie stan ekranu. */
    val szukaneN = szukane.trim().lowercase()
    val widoczne = if (szukaneN.isEmpty()) v.lines else v.lines.filter {
        it.sym.lowercase().contains(szukaneN) || it.name.lowercase().contains(szukaneN)
    }
    val uporzadkowane = uporzadkujPozycje(widoczne, { it.status }, { it.locExpected })
    val bezLok = czekaBezLokalizacji(v.lines, { it.status }, { it.locExpected })
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
    /* Także gdy panel ROŚNIE (pytanie o rozjazd, pole ręcznego wpisu) —
       bez tego dodatkowa treść uciekała pod dolną krawędź bez korekty. */
    LaunchedEffect(active?.id, mismatch?.first?.id, manualOpen) {
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
                /* Notatki biura STOJĄ NA GÓRZE, przed podpowiedzią o skanie.
                   Pytanie „czy dosłali brakujące 3 sztuki" trzeba przeczytać
                   ZANIM się zacznie, bo odpowiedź bierze się z oglądania
                   palety — a nie z pamięci pół godziny później. */
                v.notatki.forEach { n ->
                    NotatkaCard(n) { notatkaOtwarta = n }
                }

                Text(
                    "Zeskanuj towar z palety — w dowolnej kolejności",
                    fontSize = 12.sp,
                    color = InkSoft,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth(),
                )

                /* Pole filtra pod podpowiedzią o skanie, a nie nad nią: skan
                   zostaje drogą pierwszą i ma być pierwszy także wzrokiem.
                   Bez `imeAction` szukania — lista zawęża się przy pisaniu,
                   więc nie ma czego zatwierdzać. */
                WertisTextField(
                    value = szukane,
                    onValueChange = { szukane = it },
                    placeholder = "Szukaj w dostawie: symbol albo nazwa…",
                    leadingIcon = WIcons.Search,
                )
                if (szukaneN.isNotEmpty()) {
                    Text(
                        if (uporzadkowane.isEmpty()) {
                            "Brak pozycji dla „$szukane” — dostawa ma ${v.lines.size} poz."
                        } else {
                            "${uporzadkowane.size} z ${v.lines.size} poz."
                        },
                        fontSize = 11.sp,
                        color = InkMute,
                    )
                    OutlineButton(
                        "POKAŻ WSZYSTKIE POZYCJE",
                        modifier = Modifier.fillMaxWidth(),
                        onClick = { szukane = "" },
                    )
                }

                /* Dostawa ZAMKNIĘTA — stan końcowy zamiast przycisku, który
                   musiałby odmówić. Domknięcie dzieje się SAMO po ostatniej
                   pozycji (`closeIfComplete` na serwerze), więc to nie jest
                   rzadki przypadek brzegowy, tylko najczęstsze zakończenie
                   pracy: człowiek odkłada ostatnią sztukę i dostawa jest już
                   zamknięta, zanim sięgnie po przycisk.

                   Do 0.54.0 ekran tego nie wiedział — `status` przychodził
                   w danych i nie był czytany. „ZAKOŃCZ DOSTAWĘ" stało dalej,
                   dostawało 400 „Ta dostawa jest już zamknięta", a powrót na
                   listę leżał wyłącznie na ścieżce sukcesu. Objaw ze
                   zgłoszenia: dostawa zamknięta, ekran nie do opuszczenia. */
                if (v.status != "open") {
                    Text(
                        "DOSTAWA ZAKOŃCZONA",
                        fontFamily = BarlowCond,
                        fontWeight = FontWeight.ExtraBold,
                        fontSize = 15.sp,
                        color = Success,
                        modifier = Modifier.padding(top = 4.dp),
                    )
                    Text(
                        "Nie ma tu już czego rozkładać.",
                        fontSize = 12.sp,
                        color = InkMute,
                        modifier = Modifier.padding(bottom = 2.dp),
                    )
                    PrimaryButton(
                        "WRÓĆ DO LISTY DOSTAW",
                        modifier = Modifier.fillMaxWidth(),
                        leadingIcon = WIcons.Check,
                        onClick = { graph.nav.zakonczonaDostawa() },
                    )
                }
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
                    allowManual = locInfo?.allowManual != false,
                    manualOpen = manualOpen,
                    onManualOpen = { manualOpen = true },
                    // dostawa krajowa jest księgowana wprost na MAG, kontener stoi
                    // na MGP do przesunięcia — stąd różnica w opisie stanu
                    stanZawieraDostawe = magZrodlowy == null,
                    onRecznie = { wpisany ->
                        val code = normalizeLoc(wpisany)
                        val err = validateLoc(code, locInfo)
                        if (err != null) {
                            graph.effects.toast(err)
                            graph.feedback.beep(false)
                        } else {
                            scope.launch { putaway(line, code, recznie = true) }
                        }
                    },
                    nieznanyKod = nieznanyKod,
                    onNadajEan = { eanDla = line },
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
                    onKorekta = { korektaDla = line },
                    czesc = czesc,
                    onCzesc = { czesc = it },
                    onRozjazd = { action ->
                        mismatch?.let { (l, code) ->
                            // decyzja zostaje w pamięci dostawy — powtórka tej
                            // samej pary półek nie zapyta drugi raz
                            l.locExpected?.let { rozjazdPamiec[it to code] = action }
                            scope.launch { commitPutaway(l, code, action, recznie = mismatchReczna) }
                        }
                    },
                    onRozjazdAnuluj = { mismatch = null },
                )
            }
        }

        /* STOPKA — oba przyciski dostawy stoją POD listą, a nie nad nią.
           Zgłoszenie z hali i decyzja użytkownika: zakończenie ma leżeć za
           wszystkim, co jeszcze nie zostało zeskanowane. Lista jest kontrolą
           kompletności, więc dojście do przycisku prowadzi wzrokiem przez to,
           co zostało — a przycisk przestaje kusić na starcie pracy.

           Stan „DOSTAWA ZAKOŃCZONA" celowo ZOSTAJE w szapce. Na zamkniętej
           dostawie to jedyne wyjście z ekranu i schowanie go pod pozycjami
           przywróciłoby usterkę naprawioną w 0.54.0: dostawa zamknięta, ekran
           nie do opuszczenia bez przewijania.

           Stopka doklejona ZA `items` nie rusza indeksów przewijania —
           `animateScrollToItem(indeksAktywnej + 1)` wyżej dalej liczy jedną
           szapkę przed listą. */
        item(key = "stopka") {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
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

                /* Zakończenie dostawy. Przycisk otwiera PODGLĄD, nie zapis —
                   wyjątek „zła ilość" jedzie do protokołu rozbieżności, czyli
                   do dostawcy, więc nie ma prawa powstać z jednego dotknięcia
                   bez pokazania, co powstanie. Na dostawie zamkniętej go nie
                   ma: mógłby już tylko dostać odmowę (0.54.0). */
                if (v.status == "open") {
                    OutlineButton(
                        "ZAKOŃCZ DOSTAWĘ",
                        modifier = Modifier.fillMaxWidth(),
                        leadingIcon = WIcons.Check,
                        onClick = {
                            scope.launch {
                                try {
                                    zakonczenie = apiCall { graph.api.deliveryZakonczenie(id) }
                                } catch (e: Exception) {
                                    graph.effects.toast(
                                        e.message ?: "Nie udało się policzyć podsumowania"
                                    )
                                }
                            }
                        },
                    )
                }
            }
        }
    }

    notatkaOtwarta?.let { n ->
        OdpowiedzSheet(
            notatka = n,
            busy = busy,
            onCancel = { notatkaOtwarta = null },
            onWyslij = { tekst ->
                scope.launch {
                    if (busy) return@launch
                    busy = true
                    try {
                        apiCall { graph.api.deliveryOdpowiedzNotatka(n.id, OdpowiedzBody(tekst)) }
                        notatkaOtwarta = null
                        graph.feedback.zapis()
                        reload++
                    } catch (e: Exception) {
                        graph.feedback.beep(false)
                        graph.effects.toast(e.message ?: "Nie udało się zapisać odpowiedzi")
                    } finally {
                        busy = false
                    }
                }
            },
        )
    }

    /* Arkusz zakończenia: pokazuje, co powstanie, i dopiero potem zapisuje. */
    zakonczenie?.let { z ->
        ZakonczenieSheet(
            podsumowanie = z,
            busy = busy,
            onCancel = { zakonczenie = null },
            onPotwierdz = {
                scope.launch {
                    if (busy) return@launch
                    busy = true
                    try {
                        val wynik = apiCall { graph.api.deliveryZakoncz(id) }
                        zakonczenie = null
                        graph.feedback.zapis()
                        graph.effects.flashSuccess(
                            "Dostawa zakończona · ${wynik.braki.size} zgłoszeń"
                        )
                        graph.nav.zakonczonaDostawa()
                    } catch (e: Exception) {
                        /* „Już zamknięta" NIE jest porażką: stan docelowy jest
                           osiągnięty, tylko domknął ktoś inny albo automat
                           między wczytaniem ekranu a naciśnięciem przycisku.
                           Odpowiedź prowadzi więc tam, dokąd człowiek zmierzał
                           — na listę — bez dźwięku błędu. Rozpoznanie po
                           `kod`, nie po treści: zdanie wolno poprawiać. */
                        if (e is ApiError && e.kod == "juz_zamknieta") {
                            zakonczenie = null
                            graph.effects.toast("Ta dostawa była już zakończona")
                            graph.nav.zakonczonaDostawa()
                        } else {
                            graph.feedback.beep(false)
                            graph.effects.toast(e.message ?: "Nie udało się zakończyć dostawy")
                        }
                    } finally {
                        busy = false
                    }
                }
            },
        )
    }

    /* Korekta ilości odłożonej. Arkusz stoi NA POZIOMIE EKRANU, nie w środku
       innego `?.let` — zagnieżdżenie w cudzym bloku zabrało już raz widoczność
       dwóm arkuszom naraz (0.44.1) i kompilator o tym nie powie. */
    korektaDla?.let { linia ->
        KorektaSheet(
            line = linia,
            busy = busy,
            onCancel = { korektaDla = null },
            onZapisz = { qty ->
                scope.launch {
                    if (busy) return@launch
                    busy = true
                    try {
                        apiCall { graph.api.deliveryKorekta(id, linia.id, KorektaBody(qty)) }
                        korektaDla = null
                        // pozycja przestaje być „w rękach" — korekta kończy pracę
                        // na niej tak samo jak odłożenie
                        zwolnij(linia)
                        graph.feedback.zapis()
                        graph.effects.toast("${linia.sym} · odłożone ${iloscZJednostka(qty, linia.unit)}")
                        reload++
                    } catch (e: Exception) {
                        graph.feedback.beep(false)
                        graph.effects.toast(e.message ?: "Nie udało się poprawić ilości")
                    } finally {
                        busy = false
                    }
                }
            },
        )
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
            unit = linia.unit,
            magFrom = magZrodlowy,
            dostepne = linia.qtyDoc - linia.qtyDone,
            qtyInit = linia.qtyDoc - linia.qtyDone,
            lineId = linia.id,
            onDone = {
                przesunFor = null
                active = null
                czesc = null
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
                czesc = null
                reload++
            },
            onCancel = {
                problemOpen = false
                problemFor = null
                problemType = null
            },
        )
    }

    /* Nadanie kodu kartotece, która go nie ma (0.37.0). Wejście jest wyłącznie
       z rozwiniętej pozycji i wyłącznie po zeskanowaniu nieznanego kodu —
       wtedy człowiek trzyma karton i wie na pewno, że kod i towar do siebie
       pasują. `eanKartoteki` jest puste, bo linia dostawy nie niesie kodu:
       skoro skan nie trafił, kartoteka albo go nie ma, albo ma inny, i to
       serwer rozstrzygnie, czy to uzupełnienie, czy podmiana. */
    eanDla?.let { line ->
        EanSheet(
            graph = graph,
            twId = line.twId,
            sym = line.sym,
            nazwa = line.name,
            eanKartoteki = "",
            kodStartowy = nieznanyKod ?: "",
            onClose = { eanDla = null },
            onZapisano = {
                eanDla = null
                nieznanyKod = null
                graph.effects.toast("Kod nadany — od teraz skan otwiera tę pozycję")
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
    allowManual: Boolean,
    manualOpen: Boolean,
    onManualOpen: () -> Unit,
    /** Czy stan na hali zawiera już tę dostawę — patrz `PanelOdkladania`. */
    stanZawieraDostawe: Boolean,
    onRecznie: (String) -> Unit,
    /** Kod bez kartoteki zeskanowany w tej dostawie — propozycja nadania go. */
    nieznanyKod: String?,
    onNadajEan: () -> Unit,
    onTap: () -> Unit,
    onProblem: () -> Unit,
    onQtyIssue: () -> Unit,
    onPrzesun: (() -> Unit)?,
    /** Poprawienie liczby już odłożonych sztuk — patrz `PanelOdkladania`. */
    onKorekta: () -> Unit,
    /** Ile sztuk z tej pozycji idzie na półkę; `null` = cała reszta. */
    czesc: Double?,
    onCzesc: (Double?) -> Unit,
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
            /* IKONA STANU ZOSTAJE, IKONA PUDEŁKA USTĘPUJE ZDJĘCIU — i to są dwie
               różne rzeczy, mimo że rysowane w tym samym miejscu.

               `Alert` i `Check` niosą stan wiersza („zgłoszony problem",
               „odłożone"), którego zdjęcie nie zastąpi; zostają zawsze.
               `Box` nie niesie nic — to rysunek pudełka, znaczący tyle co
               „towar". Obok miniatury tego samego towaru był powtórzeniem:
               zdjęcie mówi KTÓRY towar. Dlatego jedzie jako `zamiast` i pojawia
               się wyłącznie wtedy, gdy kartoteka zdjęcia nie ma. */
            when {
                problem -> Icon(
                    WIcons.Alert,
                    contentDescription = null,
                    tint = Destructive,
                    modifier = Modifier.size(18.dp),
                )
                zwiniety -> Icon(
                    WIcons.Check,
                    contentDescription = null,
                    tint = Success,
                    modifier = Modifier.size(14.dp),
                )
            }

            /* Miniatura W PASKU, po lewej stronie symbolu — zgłoszenie
               z magazynu. Zdjęcie stoi tu w KAŻDYM trybie poza zwiniętym, więc
               rozwinięcie wiersza nie przenosi go na drugi koniec ekranu.

               Do 0.55.0 było inaczej: rozwinięty wiersz dostawał 56 dp po
               prawej, w miejscu pastylki adresu, żeby zdjęcie z nią nie
               sąsiadowało. Ten argument przestał obowiązywać — pastylki
               w rozwiniętym wierszu nie ma, bo adres krzyczy 28 sp w panelu
               niżej. Zostawała sama niespójność: ta sama pozycja pokazywała
               zdjęcie w dwóch różnych miejscach, zależnie od rozwinięcia.

               Wiersz zwinięty jej nie dostaje. Pozycja jest odłożona, więc
               rozpoznawanie towaru nic już nie wnosi, a pasek jest o połowę
               niższy właśnie po to, żeby dziesięć pozycji drobnicy zmieściło
               się na ekranie. */
            /* Rysunek pudełka zajmuje TYLE SAMO MIEJSCA co miniatura, choć sam
               jest o połowę mniejszy. Bez tego wiersz przeskakiwałby w bok
               o 18 dp w chwili doczytania zdjęcia — a to jest dokładnie ten
               ruch pod kciukiem, przed którym broni się reszta tego ekranu.
               Nie jest to „szary kwadrat, którego unikamy w listach": rysunek
               stał tu od zawsze, zmienia się wyłącznie jego obwódka. */
            val ikonaPudelka: @Composable () -> Unit = {
                Box(Modifier.size(36.dp), contentAlignment = Alignment.Center) {
                    Icon(WIcons.Box, contentDescription = null, tint = InkMute, modifier = Modifier.size(18.dp))
                }
            }
            if (!zwiniety) {
                MiniaturaTowaru(
                    graph,
                    line.twId,
                    36.dp,
                    // przy zgłoszonym problemie `Alert` już stoi na tej pozycji
                    zamiast = if (problem) null else ikonaPudelka,
                )
            }
            Column(Modifier.weight(1f)) {
                Text(
                    line.sym,
                    fontFamily = BarlowCond,
                    fontWeight = FontWeight.Bold,
                    /* 18 sp, nie 15 — symbol jest tym, po czym magazynier
                       rozpoznaje towar przy regale, i ma być czytelny z ręki
                       trzymającej karton. Zwinięty zostaje mały: pasek ma tam
                       `heightIn(min = 34.dp)`, żeby dziesięć pozycji drobnicy
                       mieściło się bez przewijania. */
                    fontSize = if (zwiniety) 13.sp else 18.sp,
                    color = if (zwiniety) InkMute else Ink,
                    textDecoration = if (zwiniety) TextDecoration.LineThrough else null,
                )
                // Nazwa i metadane znikają przy zwijaniu; symbol zostaje, bo to
                // po nim magazynier rozpoznaje towar przy regale.
                if (!zwiniety) {
                    Text(line.name, fontSize = 12.sp, color = InkSoft, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(
                        if (problem) {
                            "ZGŁOSZONY PROBLEM · ${iloscZJednostka(line.qtyDoc, line.unit)}"
                        } else {
                            iloscZJednostka(line.qtyDoc, line.unit) +
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

               Rozwinięty wiersz nie ma pastylki i nie dostaje w jej miejsce
               nic: adres krzyczy 28 sp w panelu odkładania tuż niżej, a zdjęcie
               stoi po lewej, przy symbolu. */
            // adres FAKTYCZNY, gdy pozycja już gdzieś poszła — patrz `adresWiersza`
            if (!rozwiniety) {
                LokPastylka(adresWiersza(line.locExpected, line.locActual), przygaszona = zwiniety)
            }
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
                    allowManual = allowManual,
                    manualOpen = manualOpen,
                    onManualOpen = onManualOpen,
                    stanZawieraDostawe = stanZawieraDostawe,
                    onRecznie = onRecznie,
                    nieznanyKod = nieznanyKod,
                    onNadajEan = onNadajEan,
                    onProblem = onProblem,
                    onQtyIssue = onQtyIssue,
                    onPrzesun = onPrzesun,
                    onKorekta = onKorekta,
                    onCancel = onCancel,
                    czesc = czesc,
                    onCzesc = onCzesc,
                )
            }
        }
    }
}

/**
 * Krok ilości przy odkładaniu — cel 48 dp, bo obsługiwany w rękawicy.
 *
 * Wyszarzony przy krańcu zakresu zamiast znikać: przycisk, który raz jest,
 * a raz go nie ma, przesuwa sąsiada pod kciukiem w chwili dotknięcia.
 */
@Composable
private fun KrokIlosci(znak: String, aktywny: Boolean, onClick: () -> Unit) {
    Text(
        znak,
        fontFamily = BarlowCond,
        fontWeight = FontWeight.ExtraBold,
        fontSize = 24.sp,
        textAlign = TextAlign.Center,
        color = if (aktywny) Ink else InkMute,
        modifier = Modifier
            .size(48.dp)
            .clip(RoundedCornerShape(10.dp))
            .border(1.5.dp, if (aktywny) CardBorder else Muted, RoundedCornerShape(10.dp))
            .background(CardWhite)
            .clickable(enabled = aktywny, onClick = onClick)
            .wrapContentHeight(),
    )
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
    allowManual: Boolean,
    /** Otwarte per DOSTAWA (stan w ekranie) — seria zniszczonych etykiet
        nie wymaga ponownego tapnięcia linku przy każdej pozycji. */
    manualOpen: Boolean,
    onManualOpen: () -> Unit,
    /**
     * Czy stan na hali zawiera już rozkładaną partię.
     *
     * Dostawa krajowa jest księgowana wprost na MAG, więc tak; kontener stoi
     * na MGP do czasu przesunięcia, więc nie. Różnica jest widoczna dla
     * człowieka przy regale, bo zmienia to, ilu sztuk ma się tam spodziewać.
     */
    stanZawieraDostawe: Boolean,
    /** Ręcznie wpisany kod półki — zniszczona etykieta nie może blokować pozycji. */
    onRecznie: (String) -> Unit,
    /** Kod bez kartoteki zeskanowany w tej dostawie — propozycja nadania go. */
    nieznanyKod: String?,
    onNadajEan: () -> Unit,
    onProblem: () -> Unit,
    onQtyIssue: () -> Unit,
    /** null = dostawa księgowana wprost na halę, nie ma czego przesuwać. */
    onPrzesun: (() -> Unit)?,
    /** Poprawienie liczby już odłożonych sztuk (0.45.0). */
    onKorekta: () -> Unit,
    /** Ile sztuk z tej pozycji idzie na półkę; `null` = cała reszta. */
    czesc: Double?,
    onCzesc: (Double?) -> Unit,
    onCancel: () -> Unit,
) {
    var manual by remember(line.id) { mutableStateOf("") }
    Column(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp).padding(bottom = 12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            /* Ile sztuk idzie TERAZ. Domyślnie cała reszta, bo tak wygląda
               większość odłożeń — częściowe jest wyjątkiem i ma kosztować
               dotknięcie, nie odwrotnie. Minus i plus zamiast pola: rękawica
               na klawiaturze numerycznej to trzy pomyłki na dziesięć wpisów,
               a różnice są tu małe („3 z 10 leży na wierzchu"). */
            val zostalo = line.qtyDoc - line.qtyDone
            val ile = (czesc ?: zostalo).coerceIn(1.0, zostalo.coerceAtLeast(1.0))
            KrokIlosci("−", ile > 1.0) { onCzesc((ile - 1).coerceAtLeast(1.0)) }
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(
                    iloscZJednostka(ile, line.unit),
                    fontFamily = BarlowCond,
                    fontWeight = FontWeight.ExtraBold,
                    fontSize = 32.sp,
                    color = Ink,
                )
                // „z 10" pojawia się WYŁĄCZNIE przy odłożeniu częściowym —
                // przy pełnym byłoby powtórzeniem tej samej liczby obok siebie
                if (ile < zostalo) {
                    Text(
                        "z ${formatQty(zostalo)} · reszta zostaje",
                        fontSize = 11.sp,
                        color = InkMute,
                    )
                }
            }
            KrokIlosci("+", ile < zostalo) { onCzesc(ile + 1) }
            Text(
                /* Przy pozycji odkładanej po kawałku pokazujemy adres, pod
                   którym reszta partii już leży — a nie pustkę ze snapshotu. */
                "→ ${adresWiersza(line.locExpected, line.locActual) ?: "BRAK LOKALIZACJI"}",
                fontFamily = BarlowCond,
                fontWeight = FontWeight.ExtraBold,
                fontSize = 28.sp,
                color = AmberInk,
                modifier = Modifier.weight(1f),
            )
        }
        /* Stan przy półce odpowiada na pytanie, które magazynier zadaje sobie
           z kartonem w ręce: „czy tego już tam coś leży". Rozbieżność widać
           dopiero tutaj — pusty regał przy stanie 40 znaczy, że poprzednia
           dostawa nie została rozłożona albo poszła gdzie indziej.

           Przy dostawie krajowej towar figuruje na MAG od ZAKSIĘGOWANIA
           dokumentu, więc ta liczba zawiera już niesioną partię — i mówimy
           o tym wprost, zamiast zostawiać człowieka z zagadką arytmetyczną. */
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text(
                "na hali ${formatQty(line.stanMag)}",
                fontFamily = BarlowCond,
                fontWeight = FontWeight.Bold,
                fontSize = 14.sp,
                color = Ink,
            )
            if (stanZawieraDostawe) {
                Text("(z tą dostawą)", fontSize = 11.sp, color = InkMute)
            }
            if (line.stanMgp > 0) {
                Text(
                    "· w przyjęciach ${formatQty(line.stanMgp)}",
                    fontSize = 12.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = AmberInk,
                )
            }
        }
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Icon(WIcons.Pin, null, tint = InkSoft, modifier = Modifier.size(18.dp))
            Text("zeskanuj etykietę lokalizacji", fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = InkSoft)
        }
        /* Kod, którego kartoteka nie znała, zeskanowany chwilę temu w tej
           dostawie (0.37.0). Propozycja pojawia się TYLKO tutaj i tylko gdy
           taki kod padł: człowiek stoi z tym kartonem i właśnie znalazł jego
           pozycję na liście, więc to jedyny moment, w którym wie na pewno, że
           kod i towar do siebie pasują. */
        nieznanyKod?.let { kod ->
            Text(
                "Nadaj temu towarowi zeskanowany kod $kod…",
                fontSize = 13.sp,
                fontWeight = FontWeight.SemiBold,
                color = AmberDark,
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = 48.dp)
                    .clickable(onClick = onNadajEan)
                    .wrapContentHeight(),
            )
        }
        /* Zniszczona etykieta nie może blokować pozycji — ta sama furtka co na
           ekranie zmiany lokalizacji, za tym samym przełącznikiem serwera
           (allowManual). Wpisany kod idzie DOKŁADNIE tą samą ścieżką co skan
           (putaway), więc rozjazd z kartoteką dalej pyta człowieka. */
        if (allowManual) {
            if (!manualOpen) {
                Text(
                    "Wpisz lokalizację ręcznie…",
                    fontSize = 13.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = AmberDark,
                    modifier = Modifier
                        .fillMaxWidth()
                        // pełny wiersz i 48 dp — łokieć w rękawicy, nie kursor
                        .heightIn(min = 48.dp)
                        .clickable(onClick = onManualOpen)
                        .wrapContentHeight(),
                )
            } else {
                // fokus od razu — otwarcie pola nie wymaga drugiego tapnięcia
                val fokus = remember { FocusRequester() }
                LaunchedEffect(line.id) { fokus.requestFocus() }
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        WertisTextField(
                            value = manual,
                            onValueChange = { manual = it.uppercase() },
                            placeholder = "np. E08-03-01",
                            modifier = Modifier.weight(1f).focusRequester(fokus),
                            onDone = { onRecznie(manual) },
                        )
                        PrimaryButton("OK") { onRecznie(manual) }
                    }
                    Text("Bez spacji · ręczne wpisywanie = ryzyko literówek", fontSize = 11.sp, color = InkMute)
                }
            }
        }
        // Rozkładanie JEST sprawdzaniem faktury i liczy się KAŻDĄ pozycję, więc
        // rozbieżność ilościowa to najczęstszy wyjątek — zasługuje na własny
        // przycisk, a nie na szukanie kafla wśród pięciu kategorii.
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
            OutlineButton("INNA ILOŚĆ", modifier = Modifier.weight(1f), onClick = onQtyIssue)
            OutlineButton("PROBLEM", modifier = Modifier.weight(1f), danger = true, onClick = onProblem)
        }
        /* Poprawka WŁASNEJ pomyłki w liczeniu, nie zgłoszenie do dostawcy —
           i dlatego stoi osobno, pod „INNĄ ILOŚCIĄ". Pozycja bez ani jednej
           odłożonej sztuki nie ma czego poprawiać: tam drogą jest zwykłe
           odłożenie. Przy zgłoszonym wyjątku serwer i tak odmówi, więc nie
           dajemy przycisku, który obiecuje coś, czego nie zrobi. */
        if (line.qtyDone > 0 && line.status != StatusLinii.PROBLEM) {
            OutlineButton(
                "POPRAW ILOŚĆ (${formatQty(line.qtyDone)})",
                modifier = Modifier.fillMaxWidth(),
                onClick = onKorekta,
            )
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
                            "w dokumencie: ${iloscZJednostka(c.qtyDoc ?: 0.0, c.unit)} → ${c.locExpected ?: "—"}"
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

/**
 * Potwierdzenie zakończenia dostawy.
 *
 * Dwie listy stoją osobno i to jest cała treść tego ekranu: BRAKI jadą do
 * dostawcy jako wyjątek „zła ilość", POMINIĘTE zostają w aplikacji. Wspólna
 * lista kazałaby człowiekowi zgadywać, co właśnie wysyła na zewnątrz firmy.
 *
 * Przycisk potwierdzenia mówi, ILE zgłoszeń powstanie — „ZAKOŃCZ" bez liczby
 * jest zgodą na coś, czego się nie policzyło.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ZakonczenieSheet(
    podsumowanie: ZakonczenieDostawy,
    busy: Boolean,
    onCancel: () -> Unit,
    onPotwierdz: () -> Unit,
) {
    ModalBottomSheet(onDismissRequest = onCancel, containerColor = Paper) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(
                "ZAKOŃCZYĆ DOSTAWĘ?",
                fontFamily = BarlowCond,
                fontWeight = FontWeight.ExtraBold,
                fontSize = 20.sp,
                color = Ink,
            )

            if (podsumowanie.braki.isEmpty() && podsumowanie.nietkniete.isEmpty()) {
                Text(
                    "Wszystkie pozycje są rozstrzygnięte — zakończenie tylko domknie dostawę.",
                    fontSize = 13.sp,
                    color = InkSoft,
                )
            }

            if (podsumowanie.braki.isNotEmpty()) {
                Text(
                    "ZGŁOSZENIE DO DOSTAWCY (${podsumowanie.braki.size})",
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Bold,
                    letterSpacing = 1.1.sp,
                    color = AmberInk,
                )
                Text(
                    "Policzone i było ich mniej — trafią do protokołu rozbieżności jako „zła ilość”.",
                    fontSize = 12.sp,
                    color = InkSoft,
                )
                podsumowanie.braki.forEach { b ->
                    Text(
                        "${b.sym} · ${formatQty(b.qtyDone)} z ${iloscZJednostka(b.qtyDoc, b.unit)}",
                        fontSize = 13.sp,
                        color = Ink,
                    )
                }
            }

            if (podsumowanie.nietkniete.isNotEmpty()) {
                Text(
                    "POMINIĘTE (${podsumowanie.nietkniete.size})",
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Bold,
                    letterSpacing = 1.1.sp,
                    color = InkMute,
                )
                Text(
                    "Nikt ich nie odkładał, więc NIE idą do dostawcy. Karta towaru pokaże je " +
                        "dalej jako „w dostawie”.",
                    fontSize = 12.sp,
                    color = InkSoft,
                )
                podsumowanie.nietkniete.forEach { n ->
                    Text(
                        "${n.sym} · ${iloscZJednostka(n.qtyDoc, n.unit)}",
                        fontSize = 13.sp,
                        color = InkMute,
                    )
                }
            }

            PrimaryButton(
                if (podsumowanie.braki.isEmpty()) "ZAKOŃCZ DOSTAWĘ"
                else "ZAKOŃCZ I ZGŁOŚ ${podsumowanie.braki.size}",
                modifier = Modifier.fillMaxWidth(),
                enabled = !busy,
                onClick = onPotwierdz,
            )
            OutlineButton("WRÓĆ DO POZYCJI", modifier = Modifier.fillMaxWidth(), onClick = onCancel)
        }
    }
}

/**
 * Notatka biura na liście rozkładania.
 *
 * Nieodpowiedziana jest bursztynowa i klikalna — to ona trzyma dostawę otwartą
 * i jest jedynym powodem, dla którego „ZAKOŃCZ DOSTAWĘ" odmówi. Odpowiedziana
 * gaśnie do szarości i zostaje: rozmowa jest częścią historii dostawy, a nie
 * powiadomieniem do odhaczenia.
 */
@Composable
private fun NotatkaCard(n: NotatkaDostawy, onOdpowiedz: () -> Unit) {
    val czeka = n.odpowiedz == null
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .cardSurface(
                background = if (czeka) AmberBgSoft else CardWhite,
                borderColor = if (czeka) AmberLine else CardBorder,
            )
            .then(if (czeka) Modifier.clickable(onClick = onOdpowiedz) else Modifier)
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Icon(
                WIcons.Alert,
                null,
                tint = if (czeka) AmberInk else InkMute,
                modifier = Modifier.size(15.dp),
            )
            Text(
                if (czeka) "NOTATKA BIURA · ODPOWIEDZ" else "NOTATKA BIURA",
                fontSize = 11.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = 1.1.sp,
                color = if (czeka) AmberInk else InkMute,
            )
        }
        Text(n.tresc, fontSize = 14.sp, color = Ink)
        Text("${n.createdBy} · ${n.createdAt.take(10)}", fontSize = 11.sp, color = InkMute)
        n.odpowiedz?.let { o ->
            Text("Odpowiedź: $o", fontSize = 13.sp, color = InkSoft)
            Text("${n.odpBy.orEmpty()}", fontSize = 11.sp, color = InkMute)
        }
        if (czeka) {
            Text(
                "Dostawy nie da się zamknąć bez odpowiedzi.",
                fontSize = 11.sp,
                color = AmberInk,
            )
        }
    }
}

/** Odpowiedź na notatkę — jedno pole, bo pytanie jest jedno. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun OdpowiedzSheet(
    notatka: NotatkaDostawy,
    busy: Boolean,
    onCancel: () -> Unit,
    onWyslij: (String) -> Unit,
) {
    var tekst by remember(notatka.id) { mutableStateOf("") }
    ModalBottomSheet(onDismissRequest = onCancel, containerColor = Paper) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text(
                "ODPOWIEDŹ NA NOTATKĘ",
                fontFamily = BarlowCond,
                fontWeight = FontWeight.ExtraBold,
                fontSize = 20.sp,
                color = Ink,
            )
            // pytanie zostaje na ekranie razem z polem — odpowiada się NA COŚ,
            // a przewijanie w górę po treść kosztuje przy palecie więcej niż tutaj
            Text(notatka.tresc, fontSize = 14.sp, color = Ink)
            Text("${notatka.createdBy} · ${notatka.createdAt.take(10)}", fontSize = 11.sp, color = InkMute)

            WertisTextField(
                value = tekst,
                onValueChange = { tekst = it },
                placeholder = "np. Dosłali, były w drugim kartonie",
            )
            Text(
                "Odpowiedzi nie da się później podmienić — nowe ustalenie to nowa notatka.",
                fontSize = 11.sp,
                color = InkMute,
            )
            PrimaryButton(
                "ZAPISZ ODPOWIEDŹ",
                modifier = Modifier.fillMaxWidth(),
                enabled = !busy && tekst.isNotBlank(),
                onClick = { onWyslij(tekst) },
            )
            OutlineButton("WRÓĆ", modifier = Modifier.fillMaxWidth(), onClick = onCancel)
        }
    }
}

/**
 * Korekta ilości odłożonej — poprawka pomyłki w liczeniu (0.45.0).
 *
 * Podaje się liczbę CAŁKOWITĄ, nie różnicę: człowiek przy palecie przelicza
 * sztuki na półce i wie, ile ich tam leży, a nie o ile się wcześniej pomylił.
 * Stąd suwak od zera do ilości z dokumentu, z wartością startową równą temu,
 * co dziś stoi w systemie — poprawka zaczyna się od stanu, który się poprawia.
 *
 * To NIE JEST zgłoszenie do dostawcy. Zmiana zostaje w WERTIS, nie rusza
 * Subiekta i nie tworzy wyjątku; jeśli po korekcie sztuk naprawdę brakuje,
 * do dostawcy pojedzie to dopiero z „ZAKOŃCZ DOSTAWĘ". Zdanie o tym stoi
 * w arkuszu, bo różnica między jednym a drugim jest tu całą stawką.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun KorektaSheet(
    line: DeliveryLineView,
    busy: Boolean,
    onCancel: () -> Unit,
    onZapisz: (Double) -> Unit,
) {
    var ile by remember(line.id) { mutableStateOf(line.qtyDone) }
    ModalBottomSheet(onDismissRequest = onCancel, containerColor = Paper) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text(
                "POPRAW ODŁOŻONĄ ILOŚĆ",
                fontFamily = BarlowCond,
                fontWeight = FontWeight.ExtraBold,
                fontSize = 20.sp,
                color = Ink,
            )
            Text(line.sym, fontFamily = BarlowCond, fontWeight = FontWeight.Bold, fontSize = 16.sp, color = Ink)
            Text(line.name, fontSize = 12.sp, color = InkSoft, maxLines = 2, overflow = TextOverflow.Ellipsis)

            Row(
                modifier = Modifier.fillMaxWidth().padding(top = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                KrokIlosci("−", ile > 0.0) { ile = (ile - 1).coerceAtLeast(0.0) }
                Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(
                        iloscZJednostka(ile, line.unit),
                        fontFamily = BarlowCond,
                        fontWeight = FontWeight.ExtraBold,
                        fontSize = 32.sp,
                        color = Ink,
                    )
                    Text("z ${formatQty(line.qtyDoc)} na dokumencie", fontSize = 11.sp, color = InkMute)
                }
                KrokIlosci("+", ile < line.qtyDoc) { ile = (ile + 1).coerceAtMost(line.qtyDoc) }
            }

            // co się stanie z pozycją po zapisie — mówimy wprost, bo status
            // przelicza serwer i sam skok „odłożone → do zrobienia" bez
            // uprzedzenia wygląda z hali jak skasowana praca
            Text(
                when {
                    ile >= line.qtyDoc -> "Pozycja zostanie odłożona w całości."
                    ile > 0.0 -> "Pozycja wróci na listę jako częściowo odłożona."
                    else -> "Pozycja wróci na listę jako nieodłożona."
                },
                fontSize = 12.sp,
                fontWeight = FontWeight.SemiBold,
                color = AmberDark,
            )
            Text(
                "Adres, pod którym towar już leży, zostaje bez zmian. To poprawka " +
                    "liczenia w WERTIS, nie zgłoszenie do dostawcy.",
                fontSize = 11.sp,
                color = InkMute,
            )

            PrimaryButton(
                "ZAPISZ ${formatQty(ile)} SZT",
                modifier = Modifier.fillMaxWidth(),
                enabled = !busy && ile != line.qtyDone,
                onClick = { onZapisz(ile) },
            )
            OutlineButton("WRÓĆ", modifier = Modifier.fillMaxWidth(), onClick = onCancel)
        }
    }
}
