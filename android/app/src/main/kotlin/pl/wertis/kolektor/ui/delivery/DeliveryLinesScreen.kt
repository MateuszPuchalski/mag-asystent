package pl.wertis.kolektor.ui.delivery

import android.os.SystemClock
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.fillMaxHeight
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
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
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
import pl.wertis.kolektor.core.delivery.KierunekRozbieznosci
import pl.wertis.kolektor.core.delivery.DecyzjaRozjazdu
import pl.wertis.kolektor.core.delivery.PamiecRozjazdu
import pl.wertis.kolektor.core.delivery.adresWiersza
import pl.wertis.kolektor.core.delivery.rozbieznoscStanu
import pl.wertis.kolektor.core.product.liniaZlotaStrefa
import pl.wertis.kolektor.core.delivery.czekaBezLokalizacji
import pl.wertis.kolektor.core.delivery.iloscDoOdlozenia
import pl.wertis.kolektor.core.delivery.iloscNaKaflu
import pl.wertis.kolektor.core.delivery.odlozonePoZapisie
import pl.wertis.kolektor.core.delivery.wybierzPozycjeTowaru
import pl.wertis.kolektor.core.delivery.zostaloDoOdlozenia
import pl.wertis.kolektor.core.delivery.uporzadkujPozycje
import pl.wertis.kolektor.core.delivery.trybWiersza
import pl.wertis.kolektor.core.loc.normalizeLoc
import pl.wertis.kolektor.core.loc.validateLoc
import pl.wertis.kolektor.core.net.ApiError
import pl.wertis.kolektor.core.net.KorektaBody
import pl.wertis.kolektor.core.net.KorektaResponse
import pl.wertis.kolektor.core.net.ZakonczBody
import pl.wertis.kolektor.core.delivery.pozycjaPoKodzie
import pl.wertis.kolektor.core.net.CofniecieOdlozeniaResponse
import pl.wertis.kolektor.core.net.ZgloszenieLinii
import pl.wertis.kolektor.core.net.ZmianaPolkiBody
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
import pl.wertis.kolektor.core.scan.ScanKind
import pl.wertis.kolektor.core.text.filtrujSzukaniem
import pl.wertis.kolektor.core.text.formatQty
import pl.wertis.kolektor.core.text.iloscZJednostka
import pl.wertis.kolektor.core.text.iloscZWpisu
import pl.wertis.kolektor.core.text.jednostka
import pl.wertis.kolektor.net.apiCall
import pl.wertis.kolektor.scan.ScanHandlerEffect
import pl.wertis.kolektor.ui.przesuniecie.PrzesuniecieSheet
import pl.wertis.kolektor.ui.components.LoadingRow
import pl.wertis.kolektor.ui.components.LokPastylka
import pl.wertis.kolektor.ui.components.MinTap
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

    /** Pozycja, której półkę poprawiamy po odłożeniu — `null` = arkusz zamknięty. */
    var polkaDla by remember(id) { mutableStateOf<DeliveryLineView?>(null) }

    /**
     * Ostatnie odłożenie z TEJ wizyty na ekranie — źródło paska COFNIJ.
     *
     * Po zapisie wiersz zwija się i zjeżdża na dół listy, a zielony błysk
     * trwa półtorej sekundy. Pomyłkę widzi się zwykle chwilę później, już
     * z pustymi rękami, i do tego audytu trzeba było wtedy szukać wiersza
     * na dole listy. Pasek stoi nad listą aż do następnego skanu towaru.
     *
     * Tylko po zapisie PRZYJĘTYM przez serwer. Odłożenie z bufora offline
     * serwer jeszcze nie zna, więc nie ma czego u niego cofać.
     */
    var ostatnie by remember(id) { mutableStateOf<OstatnieOdlozenie?>(null) }

    /* Kod półki i chwila ostatniego zapisu — do połknięcia DUBLA skanu.
       Przytrzymany spust skanera daje dwa odczyty tej samej etykiety. Drugi
       trafiał w ekran bez otwartej pozycji i grał ton BŁĘDU tuż po tonie
       zapisu, więc człowiek słyszał „nie wyszło" o czymś, co wyszło. */
    var ostatniZapis by remember(id) { mutableStateOf<Pair<String, Long>?>(null) }

    /** Filtr listy pozycji — patrz komentarz przy `widoczne`. */
    var szukane by rememberSaveable(id) { mutableStateOf("") }

    /* Fokus pola filtra jest STANEM EKRANU, nie szczegółem pola: dopóki go
       ma, `WedgeKeySource` nie zbiera znaków i skaner milczy. Ekran musi więc
       umieć o tym powiedzieć i umieć fokus oddać. */
    var szukaneMaFokus by remember(id) { mutableStateOf(false) }
    val fokusEkranu = LocalFocusManager.current

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

    /* WEJŚCIE Z KARTY TOWARU (0.71.0). Człowiek kliknął „W dostawie …" na
       karcie, więc wskazał już konkretny towar — szukanie go drugi raz na
       liście trzydziestu pozycji byłoby karą za trafny klik.

       Znacznik KONSUMUJEMY (zerujemy) przy pierwszym udanym wejściu: bez tego
       powrót z karty towaru na tę samą dostawę zaznaczałby pozycję ponownie,
       nadpisując to, co magazynier wybrał w międzyczasie.

       Przy `view == null` wychodzimy BEZ konsumpcji — lista jeszcze nie
       przyszła, a znacznik ma doczekać jej przyjścia. */
    LaunchedEffect(view) {
        val cel = graph.nav.pendingLineTwId ?: return@LaunchedEffect
        val lines = view?.lines ?: return@LaunchedEffect
        graph.nav.pendingLineTwId = null
        // który wiersz, gdy ten sam towar stoi w dokumencie dwa razy (S26) —
        // reguła i jej cena stoją przy `wybierzPozycjeTowaru`
        val wybrana = wybierzPozycjeTowaru(lines, cel, { it.twId }, { it.status })
        if (wybrana != null) {
            active = wybrana
            czesc = null
        }
    }
    /** Kolizja EAN — operacja stoi, aż użytkownik wybierze (D7). */
    var conflict by remember(id) { mutableStateOf<List<EanCandidate>?>(null) }
    /** Rozjazd lokalizacji — pytamy PRZED zapisem, nigdy po (§4.3). */
    var mismatch by remember(id) { mutableStateOf<Pair<DeliveryLineView, String>?>(null) }
    /** Czy kod w `mismatch` był wpisany z ręki — do raportu etykiet. */
    var mismatchReczna by remember(id) { mutableStateOf(false) }
    /* Pamięć decyzji rozjazdu W TEJ dostawie — `remember(id)` daje jej dokładnie
       tyle życia, ile ma karton. Reguła i jej uzasadnienie: `PamiecRozjazdu`. */
    val rozjazdPamiec = remember(id) { PamiecRozjazdu() }
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
                    /* Drugi skan TEJ SAMEJ pozycji nie kasuje ustawionej części.
                       Do audytu z 22 września 2026 kasował: człowiek ustawiał
                       3 z 10, skaner łapał karton drugi raz, kafel wracał do
                       10 z sygnałem sukcesu, a skan półki odkładał wszystko.
                       Część należy do jednej pozycji, więc inna pozycja nadal
                       zaczyna od całej reszty. */
                    if (active?.id != r.line.id) czesc = null
                    active = r.line
                    ostatnie = null
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
        } catch (e: java.io.IOException) {
            /* BEZ SIECI rozpoznajemy z listy w pamięci (`pozycjaPoKodzie`).
               Do audytu z 22 września 2026 skan w martwej strefie Wi-Fi nie
               otwierał pozycji wcale, a bufor offline umiał zapisać tylko tę
               otwartą, zanim sieć zniknęła. Zapis półki idzie potem przez bufor. */
            val lokalnie = view?.lines?.let { lista ->
                pozycjaPoKodzie(lista, code, { it.twId }, { it.sym }, { it.kody }, { it.status })
            }
            if (lokalnie != null) {
                graph.feedback.beep(true)
                if (active?.id != lokalnie.id) czesc = null
                active = lokalnie
                ostatnie = null
                graph.effects.toast("Bez sieci — pozycję wskazała lista, zapis poczeka na sieć")
            } else {
                graph.feedback.beep(false)
                graph.effects.toast(
                    "Brak sieci, a tego kodu nie ma na liście — wybierz pozycję palcem albo podejdź bliżej Wi-Fi"
                )
            }
        } catch (e: Exception) {
            graph.feedback.beep(false)
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
        /* Zapis w toku POŁYKA drugi skan i mówi o tym uchem. Sama cisza jest
           tu gorsza od odmowy: dokument ergonomii sam ostrzega, że powyżej
           ~300 ms ludzie skanują drugi raz, a człowiek na drabinie nie patrzy
           w ekran (dekalog p. 7) — połknięty bez sygnału czyta się jak
           zapisany. */
        if (busy) {
            graph.feedback.beep(false)
            return
        }
        busy = true
        /* Ile sztuk idzie na półkę — jedna reguła dla kafla, zapisu i echa
           bufora (`iloscDoOdlozenia`), razem z powodem, dla którego `null`
           zostaje `null`.

           KOPIA POLA, nie odczyt `czesc` w dalszych linijkach: zapis zeruje je
           zaraz po odpowiedzi, a echo bufora liczy się już PO tym zerowaniu —
           czytane stamtąd dałoby „cała reszta" przy odłożeniu częściowym. */
        val wybrana = czesc
        val ile = iloscDoOdlozenia(wybrana)
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
            ostatniZapis = code to SystemClock.elapsedRealtime()
            ostatnie = if (res.offline) null else OstatnieOdlozenie(
                lineId = line.id,
                sym = line.sym,
                ilosc = iloscZJednostka(ile ?: (line.qtyDoc - line.qtyDone).coerceAtLeast(0.0), line.unit),
                polka = code,
            )
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
                    val zrobione = odlozonePoZapisie(wybrana, line.qtyDoc, line.qtyDone)
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
        when (val decyzja = rozjazdPamiec.rozstrzygnij(line.twId, line.locExpected, code)) {
            is DecyzjaRozjazdu.Zgodna -> commitPutaway(line, code, locAction = null, recznie = recznie)

            is DecyzjaRozjazdu.Powtorz -> {
                // automat, którego nie widać, byłby cichą decyzją za człowieka
                graph.effects.toast(
                    "Inna półka niż w kartotece — jak poprzednio: " +
                        if (decyzja.akcja == LocApplyAction.REPLACE) "ZAMIEŃ" else "DODAJ"
                )
                commitPutaway(line, code, decyzja.akcja, recznie = recznie)
            }

            is DecyzjaRozjazdu.Zapytaj -> {
                graph.feedback.beep(false)
                // pochodzenie kodu przeżywa pytanie o rozjazd — inaczej ręczny
                // wpis z inną półką wypadałby z raportu etykiet
                mismatchReczna = recznie
                mismatch = line to code
            }
        }
    }

    // router skanów: gdy czekamy na lokalizację — LOC kończy operację;
    // w innym wypadku każdy skan próbuje rozstrzygnąć towar.
    /* CO BLOKUJE SKANER — jedna lista, bo `ModalBottomSheet` go NIE blokuje.

       `ScannerBus` jest globalnym stosem handlerów, niezależnym od fokusu okna
       (`scan/ScannerBus.kt`): arkusz zasłania palec, ale skan i tak spada do
       handlera ekranu pod spodem. Do 0.388.1 warunek wymieniał tylko dwa
       stany i skan pod otwartym arkuszem szedł dalej do `resolveProduct`.
       Przy kolizji EAN podmieniało to listę kandydatów pod palcem sięgającym
       po drugą pozycję — a ten arkusz sam deklaruje, że operacja STOI (D7).
       Przy korekcie ilości przestawiało wybraną pozycję, z sygnałem sukcesu,
       którego człowiek nie miał jak wytłumaczyć. Oba błędy są ciche: nic nie
       wygląda na zepsute (dekalog p. 3, „Granica tej reguły").

       `ProblemSheet`, `PrzesuniecieSheet` i `EanSheet` mają WŁASNE handlery
       i stoją na stosie wyżej, więc ich skany tu nie docierają. Zostają na
       liście mimo to: ma ona odpowiadać na pytanie „co teraz połyka skaner",
       a nie na pytanie „czego zapomniano". */
    val arkuszOtwarty = mismatch != null || problemOpen || conflict != null ||
        korektaDla != null || zakonczenie != null || notatkaOtwarta != null ||
        eanDla != null || przesunFor != null || polkaDla != null

    ScanHandlerEffect { scan ->
        if (arkuszOtwarty) {
            // decyzja człowieka nie może zostać przewinięta przypadkowym
            // strzałem skanera — ale połknięcie musi być SŁYSZALNE
            graph.feedback.beep(false)
            return@ScanHandlerEffect true
        }
        val line = active
        if (line != null && scan.kind != ScanKind.EAN) {
            val code = normalizeLoc(scan.code)
            /* Kod, którego kolektor nie rozpoznał jako adresu, przechodzi tę
               samą walidację co wpis ręczny. Do audytu szedł wprost do zapisu:
               symbol towaru z etykiety kartonu pytał o rozjazd półek, a offline
               lądował w buforze z sygnałem sukcesu i odpadał dopiero później. */
            val err = if (scan.kind == ScanKind.LOC) null else validateLoc(code, locInfo)
            if (err != null) {
                graph.feedback.beep(false)
                graph.effects.toast("$err — zeskanuj etykietę regału")
                return@ScanHandlerEffect true
            }
            scope.launch { putaway(line, code) }
        } else if (scan.kind == ScanKind.LOC &&
            ostatniZapis?.let { (kod, kiedy) ->
                kod == normalizeLoc(scan.code) && SystemClock.elapsedRealtime() - kiedy < DUBEL_SKANU_MS
            } == true
        ) {
            // dubel skanu tej samej etykiety — zapis już dał swój sygnał,
            // drugi byłby tonem błędu o czymś, co się udało
        } else if (scan.kind == ScanKind.LOC) {
            /* Etykieta regału bez otwartej pozycji. Do 0.388.1 leciała do
               `resolveProduct`, wracała jako „nieznany kod" i aplikacja
               proponowała NADAĆ JĄ towarowi jako kod kreskowy — czynność,
               którą serwer i tak odrzuca (`ean-alias` odrzuca kody o kształcie
               adresu), więc było to zaproszenie do pracy skazanej na błąd.

               Kolektor zna kształt kodu SAM (`core/scan/Scan.kt`), więc
               odpowiada bez sieci i od razu: ograniczenie jest tańsze od
               komunikatu, a komunikat ma mówić, co zrobić teraz (p. 6). */
            graph.feedback.beep(false)
            graph.effects.toast("${scan.code} to etykieta regału — najpierw zeskanuj towar")
        } else {
            scope.launch { resolveProduct(scan.code) }
        }
        true
    }

    /* Zwinięcie wiersza. Od 0.47.0 jest to czynność WYŁĄCZNIE ekranowa: skan
       nie zajmuje już pozycji, więc nie ma czego oddawać serwerowi. Funkcja
       zostaje, bo zamykanie panelu wygląda tak samo w pięciu miejscach. */
    fun zwolnij(@Suppress("UNUSED_PARAMETER") line: DeliveryLineView) {
        active = null
        czesc = null
        mismatch = null
    }

    /* ── Drogi powrotu z pomyłki (serwer: `services/cofanie-dostawy.ts`) ──────
       Każda kończy się tym samym: sygnał zapisu, zdanie o skutku i świeży
       odczyt dostawy. Błąd ma ton błędu i zdanie serwera — ten mówi, co zrobić
       zamiast (np. „najpierw OTWÓRZ PONOWNIE"). */
    fun wPowrocie(akcja: suspend () -> Unit) {
        scope.launch {
            if (busy) return@launch
            busy = true
            try {
                akcja()
                graph.feedback.zapis()
                reload++
                graph.queueRepo.refreshNow()
            } catch (e: Exception) {
                graph.feedback.beep(false)
                graph.effects.toast(e.message ?: "Nie udało się — spróbuj jeszcze raz")
            } finally {
                busy = false
            }
        }
    }

    fun cofnij(lineId: Long, sym: String) = wPowrocie {
        val r = apiCall { graph.api.deliveryCofnij(id, lineId) }
        ostatnie = null
        graph.effects.toast(opisCofniecia(sym, r))
        /* Pozycja wraca OTWARTA: następny ruch to skan właściwej półki, a drugi
           skan towaru przy powtórzonym towarze trafiłby w inny wiersz. */
        r.line?.let {
            active = it
            czesc = null
        }
    }

    fun zmienPolke(linia: DeliveryLineView, kod: String, recznie: Boolean) = wPowrocie {
        val r = apiCall {
            graph.api.deliveryZmienPolke(id, linia.id, ZmianaPolkiBody(kod, recznie.takeIf { it }))
        }
        polkaDla = null
        zwolnij(linia)
        ostatnie = ostatnie?.let { o -> if (o.lineId == linia.id) o.copy(polka = r.lok) else o }
        graph.effects.toast("${linia.sym} przeniesiony na ${r.lok}")
    }

    fun otworzPonownie() = wPowrocie {
        val r = apiCall { graph.api.deliveryOtworzPonownie(id) }
        graph.effects.toast(
            "Dostawa znów otwarta" +
                (if (r.wycofane > 0) " · wycofane zgłoszenia: ${r.wycofane}" else "") +
                (if (r.przywrocone > 0) " · wraca do pracy: ${r.przywrocone} poz." else "")
        )
    }

    fun wycofaj(linia: DeliveryLineView, z: ZgloszenieLinii) = wPowrocie {
        apiCall { graph.api.wycofajZgloszenie(z.id) }
        zwolnij(linia)
        graph.effects.toast("Zgłoszenie „${z.typLabel}” wycofane — ${linia.sym} wraca do pracy")
    }

    val v = view
    if (v == null) {
        LoadingRow("Wczytywanie dostawy…")
        return
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
    val szukaneN = szukane.trim()
    /* Dopasowanie liczy `:core` — te same reguły, co w wyszukiwarce serwera
       (`filtrujSzukaniem` → `server/src/tekst.ts`). Do 0.117.0 stało tu gołe
       `contains` na małych literach i pole wyglądało na zepsute za każdym
       razem, gdy człowiek napisał „gaznik" zamiast „Gaźnik" albo „ls51139"
       zamiast „LS51-139". */
    val widoczne = filtrujSzukaniem(v.lines, szukaneN, { it.sym }, { it.name })
    val uporzadkowane =
        uporzadkujPozycje(widoczne, { it.status }, { it.locExpected }, { it.doneAt })
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
    /* Wybranie pozycji ODDAJE FOKUS pola filtra. Filtr jest drogą do pozycji,
       a nie trybem pracy: po jej wskazaniu magazynier idzie do regału i skanuje,
       więc pole nie ma prawa dalej uciszać skanera. Dotknięcie wiersza samo
       fokusu nie zabiera — Compose zostawia go tam, gdzie był. */
    LaunchedEffect(active?.id) {
        if (active?.id != null) fokusEkranu.clearFocus()
    }
    val indeksAktywnej = active?.let { a -> uporzadkowane.indexOfFirst { it.id == a.id } } ?: -1
    /* Także gdy panel ROŚNIE (pytanie o rozjazd, pole ręcznego wpisu) —
       bez tego dodatkowa treść uciekała pod dolną krawędź bez korekty. */
    LaunchedEffect(active?.id, mismatch?.first?.id, manualOpen) {
        if (indeksAktywnej >= 0) listState.animateScrollToItem(indeksAktywnej + 1)
    }

    /* „KOMPLET" TYLKO BEZ WYJĄTKÓW I POMINIĘĆ (audyt z 22 września 2026).
       Postęp liczy pozycję z problemem i pominiętą jako załatwioną — i słusznie,
       bo nie czekają na skan. Ale zielone „KOMPLET" przy pięciu wyjątkach
       i trzech pominięciach mówiło o dostawie coś, co nie jest prawdą, na
       ekranie, który ma być kontrolą kompletności. */
    val pominiete = v.lines.count { it.status == StatusLinii.SKIPPED }
    val bezZastrzezen = v.progress.problems == 0 && pominiete == 0

    /* Pasek COFNIJ stoi NAD listą, poza przewijaniem. Wiersz odłożonej
       pozycji zjeżdża na dół, a lista przewija się do następnej — pasek
       w środku listy uciekałby razem z nimi. Góra ekranu jest daleko od
       kciuka, i dobrze: cofnięcie jest czynnością rzadką (dekalog, punkt 4). */
    Column(Modifier.fillMaxSize()) {
        ostatnie?.takeIf { active == null }?.let { o ->
            PasekCofnij(
                ostatnie = o,
                busy = busy,
                onCofnij = { cofnij(o.lineId, o.sym) },
                modifier = Modifier.padding(start = 12.dp, end = 12.dp, top = 12.dp),
            )
        }
        LazyColumn(
            state = listState,
            modifier = Modifier.fillMaxWidth().weight(1f).padding(12.dp),
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
                                        .background(if (v.progress.remaining == 0 && bezZastrzezen) Success else Amber),
                                )
                            }
                            /* „ZOSTAŁO N" zamiast samego „done/total". Lista jest
                               kontrolą kompletności, więc liczbą, po którą sięga
                               oko, jest ta, ile jeszcze leży w kartonie. */
                            Text(
                                when {
                                    v.progress.remaining > 0 -> "zostało ${v.progress.remaining}"
                                    bezZastrzezen -> "KOMPLET"
                                    else -> "ROZSTRZYGNIĘTE"
                                },
                                fontFamily = BarlowCond,
                                fontWeight = FontWeight.ExtraBold,
                                fontSize = 17.sp,
                                color = if (v.progress.remaining == 0 && bezZastrzezen) Success else Ink,
                            )
                            Text("${v.progress.done}/${v.progress.total}", fontSize = 11.sp, color = InkMute)
                        }
                        // wyjątki na tej dostawie nie mają prawa zniknąć z oczu (D8)
                        if (v.progress.problems > 0) {
                            Text(
                                "${v.progress.problems} ${if (v.progress.problems == 1) "pozycja z problemem" else "pozycje z problemem"}",
                                fontSize = 13.sp,
                                fontWeight = FontWeight.SemiBold,
                                color = Destructive,
                                modifier = Modifier.padding(top = 4.dp),
                            )
                        }
                        // pominięte to towar nierozłożony i niezgłoszony — też ma być widać
                        if (pominiete > 0) {
                            Text(
                                "pominięte: $pominiete — bez zgłoszenia do dostawcy",
                                fontSize = 13.sp,
                                fontWeight = FontWeight.SemiBold,
                                color = InkSoft,
                                modifier = Modifier.padding(top = 2.dp),
                            )
                        }
                        /* Wszystko rozstrzygnięte, a dostawa stoi otwarta: czeka
                           nadmiar (zamyka go wyłącznie ZAKOŃCZ z podglądem) albo
                           notatka biura. Bez tego zdania ekran wyglądał na
                           skończony, a przycisk leży pod ostatnim wierszem. */
                        if (v.status == "open" && v.progress.remaining == 0 && v.progress.total > 0) {
                            Text(
                                "Wszystko rozstrzygnięte — zamknij przyciskiem ZAKOŃCZ DOSTAWĘ na dole listy.",
                                fontSize = 13.sp,
                                fontWeight = FontWeight.SemiBold,
                                color = Ink,
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
                       Lista zawęża się przy pisaniu, więc „gotowe" niczego nie
                       zatwierdza — ODDAJE FOKUS, a to jest tu cała rzecz. */
                    WertisTextField(
                        value = szukane,
                        onValueChange = { szukane = it },
                        placeholder = "Szukaj w dostawie: symbol albo nazwa…",
                        leadingIcon = WIcons.Search,
                        onFokus = { szukaneMaFokus = it },
                    )
                    /* SKANER MILCZY, DOPÓKI PISZESZ — i człowiek ma o tym wiedzieć
                       (0.66.0). `WedgeKeySource` zbiera znaki wyłącznie wtedy, gdy
                       nie ma ich gdzie wpisać, więc pole z fokusem ucisza skaner.
                       Bez tego paska kolektor wyglądał na zepsuty: klawiatura
                       schowana, a skan towaru i regału nie robi nic.

                       Przycisk, nie sama podpowiedź: „gotowe" na klawiaturze
                       ekranowej trzeba najpierw znaleźć, a robi się to w rękawicy. */
                    if (szukaneMaFokus) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            Text(
                                "Skaner milczy, dopóki piszesz",
                                fontSize = 11.sp,
                                color = AmberInk,
                                fontWeight = FontWeight.SemiBold,
                                modifier = Modifier.weight(1f),
                            )
                            OutlineButton("GOTOWE") { fokusEkranu.clearFocus() }
                        }
                    }
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
                            if (bezZastrzezen) "DOSTAWA ZAKOŃCZONA" else "DOSTAWA ZAMKNIĘTA Z ZASTRZEŻENIAMI",
                            fontFamily = BarlowCond,
                            fontWeight = FontWeight.ExtraBold,
                            fontSize = 15.sp,
                            color = if (bezZastrzezen) Success else Ink,
                            modifier = Modifier.padding(top = 4.dp),
                        )
                        Text(
                            if (bezZastrzezen) "Nie ma tu już czego rozkładać."
                            else "Nierozłożone pozycje są wyżej — z problemem albo pominięte.",
                            fontSize = 13.sp,
                            color = InkSoft,
                            modifier = Modifier.padding(bottom = 2.dp),
                        )
                        PrimaryButton(
                            "WRÓĆ DO LISTY DOSTAW",
                            modifier = Modifier.fillMaxWidth(),
                            leadingIcon = WIcons.Check,
                            onClick = { graph.nav.zakonczonaDostawa() },
                        )
                        /* Droga powrotu z zamknięcia — pod wyjściem, nie nad nim:
                           wyjście jest ruchem częstym, otwarcie rzadkim. Gdy nie
                           wolno, stoi zdanie serwera zamiast wyszarzonego przycisku,
                           bo przycisk bez słowa nie mówi, do kogo iść. */
                        v.otwarcie?.let { o ->
                            if (o.mozna) {
                                OutlineButton(
                                    "OTWÓRZ PONOWNIE — POPRAW POMYŁKĘ",
                                    modifier = Modifier.fillMaxWidth(),
                                    enabled = !busy,
                                    onClick = { otworzPonownie() },
                                )
                            } else {
                                // `let`, nie smart cast: pole z modułu `:core` go nie dopuszcza
                                o.powod?.let { Text(it, fontSize = 13.sp, color = InkSoft) }
                            }
                        }
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
                            /* Tap otwiera TEN wiersz, a nie „towar o tym symbolu".
                               Do audytu z 22 września 2026 szedł przez skan po
                               symbolu: przy towarze w dwóch wierszach otwierał
                               inny wiersz niż dotknięty i nie działał bez sieci.
                               Wiersz ma z listy wszystko, czego potrzebuje panel. */
                            if (active?.id == line.id) {
                                zwolnij(line)
                            } else {
                                czesc = null
                                mismatch = null
                                ostatnie = null
                                active = line
                            }
                        },
                        onProblem = {
                            problemFor = line
                            problemOpen = true
                        },
                        onPrzesun = magZrodlowy?.let { { przesunFor = line } },
                        onCancel = { zwolnij(line) },
                        onKorekta = { korektaDla = line },
                        onCofnij = { cofnij(line.id, line.sym) },
                        onZmienPolke = { polkaDla = line },
                        onWycofaj = { z -> wycofaj(line, z) },
                        czesc = czesc,
                        onCzesc = { czesc = it },
                        onRozjazd = { action ->
                            mismatch?.let { (l, code) ->
                                // decyzja zostaje w pamięci dostawy — powtórka tej
                                // samej pary półek nie zapyta drugi raz
                                rozjazdPamiec.zapamietaj(l.twId, l.locExpected, code, action)
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
            onPotwierdz = { los ->
                scope.launch {
                    if (busy) return@launch
                    busy = true
                    try {
                        val wynik = apiCall { graph.api.deliveryZakoncz(id, ZakonczBody(los)) }
                        zakonczenie = null
                        graph.feedback.zapis()
                        graph.effects.flashSuccess(
                            "Dostawa zakończona · ${liczbaZgloszen(wynik, los)} zgłoszeń"
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
                        val r = apiCall { graph.api.deliveryKorekta(id, linia.id, KorektaBody(qty)) }
                        korektaDla = null
                        // pozycja przestaje być „w rękach" — korekta kończy pracę
                        // na niej tak samo jak odłożenie
                        zwolnij(linia)
                        ostatnie = null
                        graph.feedback.zapis()
                        graph.effects.toast(opisKorekty(linia, qty, r))
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

    /* Zmiana półki — też na poziomie ekranu, z tego samego powodu co korekta. */
    polkaDla?.let { linia ->
        ZmianaPolkiSheet(
            line = linia,
            locInfo = locInfo,
            allowManual = locInfo?.allowManual != false,
            busy = busy,
            onCancel = { polkaDla = null },
            onPolka = { kod, recznie -> zmienPolke(linia, kod, recznie) },
            onZlyKod = { komunikat ->
                graph.feedback.beep(false)
                graph.effects.toast(komunikat)
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
            // numer przesyłki pytamy RAZ na dostawę — jeśli już go zapisano,
            // arkusz o niego nie pyta, bo przesyłka jest jedna
            nrPrzesylkiZapisany = view?.nrPrzesylki,
            onDone = {
                problemOpen = false
                problemFor = null
                active = null
                czesc = null
                reload++
            },
            onCancel = {
                problemOpen = false
                problemFor = null
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
    onPrzesun: (() -> Unit)?,
    /** Poprawienie liczby już odłożonych sztuk — patrz `PanelOdkladania`. */
    onKorekta: () -> Unit,
    /** Drogi powrotu z pomyłki — patrz `PanelOdkladania`. */
    onCofnij: () -> Unit,
    onZmienPolke: () -> Unit,
    onWycofaj: (ZgloszenieLinii) -> Unit,
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
                /* Zwinięty pasek zostaje wyraźnie niższy od wiersza pracy —
                   dziesięć pozycji drobnicy ma się zmieścić na ekranie bez
                   przewijania. 40 dp zamiast 34 dp od 0.113.0: tyle potrzebuje
                   miniatura, która wróciła do tego paska (patrz niżej). */
                .heightIn(min = if (zwiniety) 40.dp else 52.dp)
                .padding(horizontal = 12.dp, vertical = if (zwiniety) 5.dp else 9.dp),
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
                /* ODZNAKA ZAMIAST PRZEKREŚLENIA (0.113.0). Do tej wersji pozycja
                   zrobiona miała symbol przekreślony linią — i to jest znak,
                   który trafia dokładnie w to, co się czyta. Symbol towaru jest
                   ciągiem znaków bez sensu słownego („LS51-139"), więc kreska
                   przez środek każe go składać literami przez przeszkodę,
                   a właśnie po nim sprawdza się, CO poszło na półkę.

                   Stan niesie teraz zielony krążek z fajką, stojący POZA
                   tekstem, w jednej kolumnie przez całą grupę zrobionych.
                   Pominięta dostaje bursztyn i wykrzyknik — to nie jest ten sam
                   stan, a do 0.113.0 obie miały tę samą zieloną fajkę. */
                zwiniety -> {
                    val pominieta = line.status == StatusLinii.SKIPPED
                    Box(
                        modifier = Modifier
                            .size(20.dp)
                            .clip(RoundedCornerShape(50))
                            .background(if (pominieta) AmberBg else Success.copy(alpha = 0.16f)),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(
                            if (pominieta) WIcons.Alert else WIcons.Check,
                            contentDescription = null,
                            tint = if (pominieta) AmberInk else Success,
                            modifier = Modifier.size(12.dp),
                        )
                    }
                }
            }

            /* Miniatura W PASKU, po lewej stronie symbolu — zgłoszenie
               z magazynu. Zdjęcie stoi tu w KAŻDYM trybie wiersza, więc ani
               rozwinięcie, ani odłożenie nie przenosi go na drugi koniec
               ekranu; zmienia się wyłącznie jego bok.

               Do 0.55.0 było inaczej: rozwinięty wiersz dostawał 56 dp po
               prawej, w miejscu pastylki adresu, żeby zdjęcie z nią nie
               sąsiadowało. Ten argument przestał obowiązywać — pastylki
               w rozwiniętym wierszu nie ma, bo adres krzyczy 28 sp w panelu
               niżej. Zostawała sama niespójność: ta sama pozycja pokazywała
               zdjęcie w dwóch różnych miejscach, zależnie od rozwinięcia.

               Od 0.113.0 zdjęcie stoi TAKŻE w pasku zrobionej pozycji, w 28 dp.
               Poprzednia decyzja („pozycja odłożona, rozpoznawanie towaru nic
               już nie wnosi") pomijała to, po co się do tej grupy wraca: żeby
               sprawdzić, czy poszło to, co miało pójść, i czy trafiło na tę
               półkę. Na to pytanie zdjęcie odpowiada szybciej niż symbol —
               a kosztuje sześć punktów wysokości paska. */
            /* Rysunek pudełka zajmuje TYLE SAMO MIEJSCA co miniatura, choć sam
               jest o połowę mniejszy. Bez tego wiersz przeskakiwałby w bok
               o 18 dp w chwili doczytania zdjęcia — a to jest dokładnie ten
               ruch pod kciukiem, przed którym broni się reszta tego ekranu.
               Nie jest to „szary kwadrat, którego unikamy w listach": rysunek
               stał tu od zawsze, zmienia się wyłącznie jego obwódka. */
            /* Rozwinięty wiersz dostaje kafelek 44 dp na białym tle — nagłówek
               karty z makiety. Oczekujący zostaje przy 36 dp: tam liczy się
               gęstość listy, a nie okazałość jednej pozycji. */
            /* Rozwinięty ma 48 dp, nie 44 jak do 0.206.0. Od tego wydania
               miniatura rozwiniętego wiersza JEST celem dotyku (powiększenie
               zdjęcia), a cel dotyku ma minimum 48 dp — punkt 4 dekalogu.
               Zwinięty i oczekujący zostają przy swoich rozmiarach, bo tam
               miniatura klikalna nie jest. */
            val bokMiniatury = when {
                rozwiniety -> 48.dp
                zwiniety -> 28.dp
                else -> 36.dp
            }
            val ikonaPudelka: @Composable () -> Unit = {
                Box(
                    Modifier
                        .size(bokMiniatury)
                        .then(
                            if (rozwiniety) {
                                Modifier
                                    .clip(RoundedCornerShape(10.dp))
                                    .background(CardWhite)
                                    .border(1.dp, CardBorder, RoundedCornerShape(10.dp))
                            } else {
                                Modifier
                            }
                        ),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(WIcons.Box, contentDescription = null, tint = InkMute, modifier = Modifier.size(20.dp))
                }
            }
            MiniaturaTowaru(
                graph,
                line.twId,
                bokMiniatury,
                /* Powiększenie WYŁĄCZNIE w rozwiniętym wierszu (0.206.0).
                   Zgłoszenie właściciela: przy regale trzeba czasem sprawdzić,
                   czy karton niesie tę kartotekę — nazwy różnią się końcówką,
                   a miniatura w rękawicy nie rozstrzyga.

                   Cała karta wiersza jest klikalna (zwija i rozwija), więc
                   miniatura klikalna ZABIERA jej dotknięcie. W rozwiniętym to
                   uczciwa zamiana: karta jest duża, zwinie ją dotknięcie
                   obok. W zwiniętym i oczekującym byłby to cel 28–36 dp z inną
                   akcją niż reszta gęstej listy — czyli pomyłka co kilka
                   pozycji, w rękawicy. */
                powieksz = rozwiniety,
                // przy zgłoszonym problemie `Alert` już stoi na tej pozycji
                zamiast = if (problem) null else ikonaPudelka,
            )
            Column(Modifier.weight(1f)) {
                Text(
                    line.sym,
                    fontFamily = BarlowCond,
                    fontWeight = if (rozwiniety) FontWeight.ExtraBold else FontWeight.Bold,
                    /* Symbol jest tym, po czym magazynier rozpoznaje towar przy
                       regale, i ma być czytelny z ręki trzymającej karton.
                       Rozwinięty dostaje 20 sp jako nagłówek karty, oczekujący
                       18 sp. Zwinięty zostaje mały: pasek ma tam
                       `heightIn(min = 34.dp)`, żeby dziesięć pozycji drobnicy
                       mieściło się bez przewijania. */
                    fontSize = when {
                        zwiniety -> 14.sp
                        rozwiniety -> 20.sp
                        else -> 18.sp
                    },
                    /* `InkSoft`, nie `InkMute`: pasek ma być cichszy od pracy do
                       zrobienia, ale nadal CZYTELNY — to po nim sprawdza się,
                       co już poszło. Przekreślenie zniknęło, powód stoi przy
                       odznace wyżej. */
                    color = if (zwiniety) InkSoft else Ink,
                )
                // Nazwa i metadane znikają przy zwijaniu; symbol zostaje, bo to
                // po nim magazynier rozpoznaje towar przy regale.
                if (!zwiniety) {
                    Text(line.name, fontSize = 12.sp, color = InkSoft, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    /* Linia ilości znika z nagłówka po ROZWINIĘCIU: ta sama
                       liczba stoi wtedy 30 sp niżej, w kaflu. Zostaje przy
                       pozycji oczekującej i przy zgłoszonym problemie — tam
                       kafla nie ma. */
                    if (!rozwiniety || problem) {
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
            }
            /* ✕ zamiast „ANULUJ" na dole panelu (0.57.0). Zwinięcie było dotąd
               ostatnim przyciskiem długiej kolumny, czyli najdalej od miejsca,
               w którym człowiek trzyma wzrok. Powtórny tap w pasek działa jak
               działał — to jest droga druga, nie zamiennik. */
            if (rozwiniety) {
                // ergonomia: cel 36 dp świadomie — ten sam skutek daje powtórny
                // tap w cały pasek, więc krzyżyk jest drogą DRUGĄ, nie jedyną
                Box(
                    Modifier
                        .size(36.dp)
                        .clip(RoundedCornerShape(50))
                        .background(CardWhite)
                        .border(1.dp, CardBorder, RoundedCornerShape(50))
                        .clickable(onClick = onTap),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(WIcons.Close, contentDescription = "Zwiń pozycję", tint = InkSoft, modifier = Modifier.size(16.dp))
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
                    onPrzesun = onPrzesun,
                    onKorekta = onKorekta,
                    onCofnij = onCofnij,
                    onZmienPolke = onZmienPolke,
                    onWycofaj = onWycofaj,
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
    /** null = dostawa księgowana wprost na halę, nie ma czego przesuwać. */
    onPrzesun: (() -> Unit)?,
    /** Poprawienie liczby już odłożonych sztuk (0.45.0). */
    onKorekta: () -> Unit,
    /** Cofnięcie ostatniego odłożenia: ilość, półka i adres w Subiekcie. */
    onCofnij: () -> Unit,
    /** Ta sama ilość, inna półka — towar leży gdzie indziej, niż zeskanowano. */
    onZmienPolke: () -> Unit,
    /** Wycofanie własnego zgłoszenia, gdy okazało się pomyłką. */
    onWycofaj: (ZgloszenieLinii) -> Unit,
    /** Ile sztuk z tej pozycji idzie na półkę; `null` = cała reszta. */
    czesc: Double?,
    onCzesc: (Double?) -> Unit,
) {
    var manual by remember(line.id) { mutableStateOf("") }
    Column(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp).padding(bottom = 12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        /* DWA KAFLE OBOK SIEBIE (0.57.0, wg makiety). Wcześniej te same treści
           stały jedna pod drugą w czterech osobnych wierszach: ilość z adresem,
           „na hali", podpowiedź skanu i osobny link ręcznego wpisu. Panel rósł
           w dół i spychał przyciski poza ekran.

           Podział jest treścią, nie ozdobą: po lewej to, co magazynier USTAWIA,
           po prawej to, dokąd IDZIE. */
        val zostalo = zostaloDoOdlozenia(line.qtyDoc, line.qtyDone)
        /* Górnej granicy nie ma od 0.64.0 — nadmiar ponad fakturę jest
           dozwolony. Bramką jest przycisk `+`, nie ścinanie liczby: przekroczenie
           wymaga jednego potwierdzenia, a potem licznik idzie swobodnie.
           TA SAMA liczba idzie do zapisu (`iloscDoOdlozenia`) — wcześniej kafel
           i zapis liczyły ją osobno i rozjechały się dokładnie o nadmiar. */
        val ile = iloscNaKaflu(czesc, line.qtyDoc, line.qtyDone)
        /* Pytanie zadajemy RAZ NA POZYCJĘ. Przy każdym kroku byłoby karą za
           liczenie sztuk, a przy zerowej liczbie pytań przypadkowe dotknięcie
           `+` wysyłałoby dostawcy reklamację. */
        var nadmiarOk by remember(line.id) { mutableStateOf(false) }
        /* Ilość CZEKAJĄCA na zgodę, nie sama flaga „pytamy" — od 0.113.0
           nadmiar wchodzi dwiema drogami (krok `+` i wpisanie liczby), więc
           potwierdzenie musi wiedzieć, na co się zgadza. */
        var nadmiarDo by remember(line.id) { mutableStateOf<Double?>(null) }
        /* Otwarte pole wpisywania ilości; `null` = zamknięte. Wpis trzymamy
           jako TEKST, bo w trakcie pisania „1", „1," i „1,2" są poprawnymi
           stanami klawiatury, a żaden z nich nie jest jeszcze liczbą. */
        var wpisIlosci by remember(line.id) { mutableStateOf<String?>(null) }

        /* Jedna droga wyjścia dla obu sposobów podania ilości: krok `+` i wpis
           kończą się tu samo. Nadmiar pyta RAZ — potem licznik idzie swobodnie. */
        fun ustawIlosc(nowa: Double) {
            if (nowa > zostalo && !nadmiarOk) nadmiarDo = nowa else onCzesc(nowa)
        }
        /* `IntrinsicSize.Min` na wierszu plus `fillMaxHeight` na obu kaflach:
           oba dostają wysokość WYŻSZEGO z nich. Bez tego biały rósł o linijkę
           „z 10 · reszta zostaje" albo „w przyjęciach", a ciemny zostawał
           niższy — dwa kafle tej samej rangi wyglądały jak kafel i przypis. */
        Row(
            modifier = Modifier.fillMaxWidth().height(IntrinsicSize.Min),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            /* KAFEL BIAŁY — ile sztuk idzie TERAZ. Domyślnie cała reszta, bo
               tak wygląda większość odłożeń; częściowe jest wyjątkiem i ma
               kosztować dotknięcie, nie odwrotnie.

               Licznik − / + JEST domyślną drogą i to się nie zmienia: rękawica
               na klawiaturze numerycznej to trzy pomyłki na dziesięć wpisów,
               a różnice bywają tu małe („3 z 10 leży na wierzchu"). Od 0.113.0
               obok niego stoi jednak WPISYWANIE — dotknięcie samej liczby.
               Zgłoszenie z hali: przy stu sztukach nadmiaru licznik znaczył sto
               stuknięć, czyli drogę, której nikt nie przejdzie. */
            Column(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxHeight()
                    .clip(RoundedCornerShape(14.dp))
                    .background(CardWhite)
                    .border(1.dp, CardBorder, RoundedCornerShape(14.dp))
                    .padding(10.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    KrokIlosci("−", ile > 1.0) { onCzesc((ile - 1).coerceAtLeast(1.0)) }
                    /* Liczba i jednostka OSOBNO, jak na makiecie. Jeden napis
                       „192 szt" w 30 sp nie mieści się między dwoma celami
                       48 dp na połowie szerokości ekranu — a celów nie
                       zmniejszamy, bo to reguła pracy w rękawicy. */
                    /* SAMA LICZBA JEST PRZYCISKIEM (0.113.0) — dotknięcie
                       otwiera pole wpisywania. Ze zgłoszenia z hali: przy stu
                       sztukach nadmiaru trzeba było stuknąć `+` sto razy.
                       Licznik zostaje dla różnic, które są tu regułą („trzy
                       z dziesięciu leżą na wierzchu"); wpis jest drogą dla
                       liczb, których nikt nie wyklika. */
                    Row(
                        modifier = Modifier
                            .weight(1f)
                            .clip(RoundedCornerShape(8.dp))
                            .clickable { wpisIlosci = formatQty(ile) },
                        horizontalArrangement = Arrangement.Center,
                        verticalAlignment = Alignment.Bottom,
                    ) {
                        Text(
                            formatQty(ile),
                            fontFamily = BarlowCond,
                            fontWeight = FontWeight.ExtraBold,
                            fontSize = 30.sp,
                            color = Ink,
                            maxLines = 1,
                        )
                        /* „szt." przy liczbie nie niesie nic: sztuki są
                           domyślne i widać je w każdym wierszu listy. Metry,
                           litry i komplety ZOSTAJĄ — tam sama liczba zmienia
                           znaczenie, a pomyłka kosztuje odcięcie złej długości. */
                        if (line.unit.isNotBlank() && jednostka(line.unit) != "szt.") {
                            Text(
                                " ${jednostka(line.unit)}",
                                fontSize = 11.sp,
                                fontWeight = FontWeight.SemiBold,
                                color = InkMute,
                                modifier = Modifier.padding(bottom = 4.dp),
                            )
                        }
                    }
                    KrokIlosci("+", true) { ustawIlosc(ile + 1) }
                }
                /* Zaproszenie do wpisania — bez niego liczba wygląda na
                   napis, a nie na przycisk. Znika, gdy pole już stoi otwarte
                   niżej: dwa zaproszenia do tej samej rzeczy naraz. */
                if (wpisIlosci == null) {
                    Text(
                        "dotknij liczby, aby wpisać",
                        fontSize = 10.5.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = AmberInk,
                        modifier = Modifier.clickable { wpisIlosci = formatQty(ile) },
                    )
                }
                // „z 10" pojawia się WYŁĄCZNIE przy odłożeniu częściowym —
                // przy pełnym byłoby powtórzeniem tej samej liczby obok siebie
                if (ile < zostalo) {
                    Text("z ${formatQty(zostalo)} · reszta zostaje", fontSize = 11.sp, color = InkMute)
                } else if (ile > zostalo) {
                    // stan, którego nie widać nigdzie indziej, a zmienia skutek zapisu
                    Text(
                        "o ${formatQty(ile - zostalo)} ponad fakturę",
                        fontSize = 11.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = Destructive,
                    )
                }
                /* Stan przy półce odpowiada na pytanie, które magazynier zadaje
                   sobie z kartonem w ręce: „czy tego już tam coś leży".
                   Rozbieżność widać dopiero tutaj — pusty regał przy stanie 40
                   znaczy, że poprzednia dostawa nie została rozłożona albo
                   poszła gdzie indziej.

                   Przy dostawie krajowej towar figuruje na MAG od ZAKSIĘGOWANIA
                   dokumentu, więc ta liczba zawiera już niesioną partię —
                   i mówimy o tym wprost, zamiast zostawiać człowieka z zagadką
                   arytmetyczną. */
                /* WSKAŹNIK ROZBIEŻNOŚCI (0.63.0) — na TEJ linijce, nie obok.
                   Osobny pasek z własnym zdaniem („ponad dokument 19 szt.")
                   mówił to samo dwa razy: liczba stanu i ilość z dokumentu
                   stoją tuż obok siebie, więc różnicę widać, zamiast ją
                   czytać. Zostaje sam sygnał — strzałka i kolor.

                   Regułę liczy `:core`, razem z tym, z którym magazynem wolno
                   się porównywać. Tutaj zostaje wyłącznie rysowanie. */
                val rozbieznosc = rozbieznoscStanu(
                    qtyDoc = line.qtyDoc,
                    stanMag = line.stanMag,
                    stanMgp = line.stanMgp,
                    stanZawieraDostawe = stanZawieraDostawe,
                )
                val niedobor = rozbieznosc?.kierunek == KierunekRozbieznosci.NIEDOBOR
                Text(
                    buildString {
                        // strzałka PRZED liczbą, bo dotyczy całego zdania
                        if (rozbieznosc != null) append(if (niedobor) "▼ " else "▲ ")
                        append("na hali ${formatQty(line.stanMag)}")
                        if (stanZawieraDostawe) append(" z tą dostawą")
                        if (line.stanMgp > 0) append(" · w przyjęciach ${formatQty(line.stanMgp)}")
                    },
                    fontSize = 11.sp,
                    /* Niedobór czerwony, nadwyżka bursztynowa, zgodność bez
                       zmian. Nadwyżka informuje („leży już zapas"), niedobór
                       ostrzega („system widzi mniej, niż mówi dokument") —
                       jeden kolor na oba kazałby dopiero czytać, co zaszło. */
                    fontWeight = if (rozbieznosc != null) FontWeight.SemiBold else FontWeight.Normal,
                    color = when {
                        rozbieznosc == null -> InkMute
                        niedobor -> Destructive
                        else -> AmberInk
                    },
                )
            }

            /* KAFEL CIEMNY — dokąd to idzie. Adres schodzi z 28 sp na 24 sp
               i to jedyne miejsce, gdzie makieta odwraca wcześniejszą decyzję
               („z lokalizacją idzie się do regału i czyta ją z odległości
               ramienia"). Rekompensatą jest BIEL NA CIEMNYM zamiast bursztynu
               na kremowym: kontrast rośnie mocniej, niż spada rozmiar. Kto
               będzie to kiedyś „poprawiał", niech zmieni oba naraz. */
            Column(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxHeight()
                    .clip(RoundedCornerShape(14.dp))
                    .background(Ink)
                    .padding(10.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Text(
                    /* Przy pozycji odkładanej po kawałku pokazujemy adres, pod
                       którym reszta partii już leży — a nie pustkę ze snapshotu. */
                    adresWiersza(line.locExpected, line.locActual) ?: "BRAK LOKALIZACJI",
                    fontFamily = BarlowCond,
                    fontWeight = FontWeight.ExtraBold,
                    fontSize = 24.sp,
                    color = CardWhite,
                    maxLines = 1,
                )
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(5.dp),
                ) {
                    Icon(WIcons.Pin, null, tint = Amber, modifier = Modifier.size(13.dp))
                    /* Ręczny wpis wchodzi TUTAJ, jako druga połowa zdania —
                       zniszczona etykieta nie może blokować pozycji. Człon
                       „lub wpisz…" pojawia się wyłącznie, gdy serwer na to
                       pozwala (`allowManual`); inaczej zostaje samo polecenie
                       skanu i nikt nie szuka wyjścia, którego nie ma. */
                    Text(
                        if (allowManual && !manualOpen) "skanuj regał lub " else "skanuj regał",
                        fontSize = 10.5.sp,
                        color = CardWhite.copy(alpha = 0.75f),
                    )
                    if (allowManual && !manualOpen) {
                        Text(
                            "wpisz…",
                            fontSize = 10.5.sp,
                            fontWeight = FontWeight.Bold,
                            color = Amber,
                            modifier = Modifier.clickable(onClick = onManualOpen),
                        )
                    }
                }
            }
        }

        /* PODPOWIEDŹ PRZESLOTOWANIA (0.71.0) — ta sama linia, co na karcie
           towaru, i celowo TEN SAM tekst z `:core`. Dwa zdania o tej samej
           rzeczy rozjechałyby się przy pierwszej poprawce jednego z nich.

           Miejsce jest lepsze niż na karcie: tam odpowiada na pytanie, którego
           nikt nie zadał, a tutaj trafia w moment wyboru półki — człowiek stoi
           z towarem w ręce. Stoi POD kaflem adresu, bo dotyczy właśnie jego. */
        line.zlotaStrefa?.let { z ->
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(12.dp))
                    .background(AmberBg)
                    .padding(horizontal = 9.dp, vertical = 7.dp),
                verticalAlignment = Alignment.Top,
                horizontalArrangement = Arrangement.spacedBy(7.dp),
            ) {
                Icon(
                    WIcons.Pin,
                    null,
                    tint = AmberInk,
                    modifier = Modifier.size(15.dp).padding(top = 1.dp),
                )
                Text(
                    liniaZlotaStrefa(z),
                    fontSize = 12.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = AmberInk,
                    lineHeight = 16.sp,
                    maxLines = 2,
                )
            }
        }

        /* POLE WPISYWANIA ILOŚCI (0.113.0). Stoi POD kaflami, tak jak ręczny
           wpis adresu — kafel ma pół szerokości ekranu i pole z przyciskiem
           by się w nim nie zmieściło bez zmniejszania celów dotyku.

           Wpis nie omija pytania o nadmiar: przechodzi tą samą drogą co krok
           `+`, więc „120" przy fakturze na 20 dalej wymaga zgody. Klawiatura
           numeryczna, bo to liczba — i `WertisTextField`, bo tylko on ucisza
           skaner na czas pisania. */
        wpisIlosci?.let { wpis ->
            val fokus = remember(line.id) { FocusRequester() }
            LaunchedEffect(line.id) { fokus.requestFocus() }
            val liczba = iloscZWpisu(wpis)
            /* Zero i wpis bez sensu nie zamykają pola — człowiek widzi wtedy
               to, co napisał, zamiast zgadywać, czemu liczba się nie zmieniła.
               Odkładanie zerowej ilości ma własną drogę: POPRAW ILOŚĆ. */
            fun zatwierdz() {
                val v = iloscZWpisu(wpis) ?: return
                if (v < 1.0) return
                wpisIlosci = null
                ustawIlosc(v)
            }
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    WertisTextField(
                        value = wpis,
                        onValueChange = { wpisIlosci = it },
                        placeholder = "np. 120",
                        keyboardType = KeyboardType.Number,
                        modifier = Modifier.weight(1f).focusRequester(fokus),
                        onDone = { zatwierdz() },
                    )
                    PrimaryButton("USTAW", enabled = liczba != null && liczba >= 1.0) { zatwierdz() }
                    OutlineButton("✕") { wpisIlosci = null }
                }
                Text(
                    "Cała ilość na tę półkę, nie różnica. Reszta partii zostaje na liście.",
                    fontSize = 11.sp,
                    color = InkMute,
                )
            }
        }

        /* POTWIERDZENIE NADMIARU (0.64.0). Pasek pod kaflami, nie okno na pół
           ekranu: pytanie dotyczy liczby, która stoi tuż wyżej, więc ma być
           widoczne RAZEM z nią. Ta sama zasada co przy rozjeździe adresu.

           Mówimy wprost, co się stanie po zamknięciu dostawy — zgoda na coś,
           czego skutku nie widać, nie jest zgodą. */
        nadmiarDo?.let { doIlu ->
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(12.dp))
                    .background(Destructive.copy(alpha = 0.08f))
                    .padding(10.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text(
                    "Odkładasz ${formatQty(doIlu)}, a na fakturze jest " +
                        "${formatQty(line.qtyDoc)}. Po zakończeniu dostawy biuro " +
                        "dostanie zgłoszenie nadmiaru.",
                    fontSize = 12.sp,
                    color = Ink,
                    lineHeight = 16.sp,
                )
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    /* Zgoda jest przyciskiem GŁÓWNYM, bo to ona jest odpowiedzią
                       na pytanie „ile naprawdę przyjechało". Odmowa zostaje
                       obrysowana — cofa do liczby z faktury i niczego nie psuje. */
                    PrimaryButton("ODŁÓŻ WIĘCEJ", modifier = Modifier.weight(1f)) {
                        nadmiarOk = true
                        nadmiarDo = null
                        onCzesc(doIlu)
                    }
                    OutlineButton("ANULUJ", modifier = Modifier.weight(1f)) {
                        nadmiarDo = null
                    }
                }
            }
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
           (putaway), więc rozjazd z kartoteką dalej pyta człowieka.

           WEJŚCIE przeniosło się do ciemnego kafla („lub wpisz…"), bo tam stoi
           zdanie o lokalizacji. Tu zostaje samo POLE — pojawia się dopiero po
           otwarciu i nie zajmuje wiersza, gdy nikt go nie potrzebuje. */
        if (allowManual && manualOpen) {
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
        /* Sam PROBLEM, na pełną szerokość. Skrót „INNA ILOŚĆ" zniknął w 0.57.0
           razem ze swoim powodem: dawał własny przycisk najczęstszemu wyjątkowi,
           żeby nie szukać go wśród PIĘCIU kafli. Kafli dla pozycji są teraz
           cztery, a „Zła ilość" stoi PIERWSZA — skrót oszczędzał więc już tylko
           jedno tapnięcie, kosztem drugiego przycisku w miejscu, w którym każdy
           zabiera wzrok. */
        OutlineButton(
            "PROBLEM",
            modifier = Modifier.fillMaxWidth(),
            danger = true,
            onClick = onProblem,
        )
        /* Poprawka WŁASNEJ pomyłki w liczeniu, nie zgłoszenie do dostawcy —
           i dlatego stoi osobno, pod „PROBLEMEM". Pozycja bez ani jednej
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
        /* DROGI POWROTU Z POMYŁKI. Przyciski niosą w napisie TO, co cofną —
           liczbę i półkę. „COFNIJ" bez dopełnienia kazałoby pamiętać, co
           było ostatnie, a właśnie tego człowiek po pomyłce nie jest pewien.
           Pokazuje je serwer (`cofnij`, `zgloszenie`), więc znikają same po
           korekcie ilości i po cofnięciu. */
        /* Pozycja rozłożona na kilka półek pokazuje je wszystkie. Wiersz na
           liście niesie tylko ostatnią (`locActual`), a pytanie po pomyłce
           brzmi właśnie „gdzie poszła reszta". */
        if (line.odlozenia.size > 1) {
            Text(
                "Odłożono: " + line.odlozenia.joinToString(" · ") {
                    "${iloscZJednostka(it.qty, line.unit)} → ${it.lok}"
                },
                fontSize = 14.sp,
                fontWeight = FontWeight.SemiBold,
                color = Ink,
            )
        }
        line.cofnij?.takeIf { line.status != StatusLinii.PROBLEM }?.let { c ->
            OutlineButton(
                "COFNIJ ODŁOŻENIE (${iloscZJednostka(c.qty, line.unit)} z ${c.lok})",
                modifier = Modifier.fillMaxWidth(),
                onClick = onCofnij,
            )
            OutlineButton(
                "ZMIEŃ PÓŁKĘ (teraz ${c.lok})",
                modifier = Modifier.fillMaxWidth(),
                onClick = onZmienPolke,
            )
        }
        line.zgloszenie?.let { z ->
            OutlineButton(
                "WYCOFAJ ZGŁOSZENIE: ${z.typLabel.uppercase()}",
                modifier = Modifier.fillMaxWidth(),
                onClick = { onWycofaj(z) },
            )
        }
        /* Skrót dla kontenera: dostawa na MGP zostawia po odłożeniu adresów
           jeszcze przesunięcie stanu na halę. Bez tego przycisku trzeba by je
           robić z karty towaru, pozycja po pozycji. Po dostawie księgowanej
           wprost na MAG nie ma czego przesuwać i przycisku nie ma. */
        onPrzesun?.let {
            OutlineButton("PRZESUŃ NA HALĘ", modifier = Modifier.fillMaxWidth(), onClick = it)
        }
        /* „ANULUJ" zniknął w 0.57.0 — przejął go ✕ w nagłówku karty. Był
           ostatnim przyciskiem długiej kolumny, czyli najdalej od miejsca,
           w którym człowiek trzyma wzrok, i najbliżej „PRZESUŃ NA HALĘ",
           z którym nie ma nic wspólnego. */
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
                /* Powiększenie także tu (0.206.0), choć wiersz służy WYBOROWI.
                   Dotknięcie zdjęcia zamiast wyboru kosztuje jedno zbędne
                   dotknięcie; wybór złej kartoteki kosztuje zły towar na
                   dokumencie. Dekalog rozstrzyga taki spór na korzyść mniejszej
                   liczby błędów, nie mniejszej liczby interakcji. */
                MiniaturaTowaru(graph, c.twId, 56.dp, powieksz = true)
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
    /** `los` — `brak` albo `pomin` dla nietkniętych; `null`, gdy ich nie ma. */
    onPotwierdz: (los: String?) -> Unit,
) {
    /* WYBÓR DLA NIETKNIĘTYCH JEST OBOWIĄZKOWY (decyzja właściciela po audycie
       z 22 września 2026). Do tej wersji szły po cichu do pominiętych: 1 z 10
       dawało reklamację, 0 z 10 — nic, a zafakturowany towar wisiał w sprzedaży.
       Żadna opcja nie jest zaznaczona z góry, bo domyślna byłaby znowu cichą
       decyzją za człowieka. Serwer bez wyboru i tak odmawia. */
    var los by remember { mutableStateOf<String?>(null) }
    val saNietkniete = podsumowanie.nietkniete.isNotEmpty()
    val zgloszen = liczbaZgloszen(podsumowanie, los)
    ModalBottomSheet(onDismissRequest = onCancel, containerColor = Paper) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp)
                .padding(bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(
                "ZAKOŃCZYĆ DOSTAWĘ?",
                fontFamily = BarlowCond,
                fontWeight = FontWeight.ExtraBold,
                fontSize = 20.sp,
                color = Ink,
            )

            if (podsumowanie.braki.isEmpty() && !saNietkniete && podsumowanie.nadmiary.isEmpty()) {
                Text(
                    "Wszystkie pozycje są rozstrzygnięte — zakończenie tylko domknie dostawę.",
                    fontSize = 13.sp,
                    color = InkSoft,
                )
            }

            if (podsumowanie.braki.isNotEmpty()) {
                NaglowekSekcjiZakonczenia("ZGŁOSZENIE DO DOSTAWCY (${podsumowanie.braki.size})")
                Text(
                    "Policzone i było ich mniej — trafią do protokołu rozbieżności jako „zła ilość”.",
                    fontSize = 13.sp,
                    color = InkSoft,
                )
                podsumowanie.braki.forEach { b ->
                    Text(
                        "${b.sym} · ${formatQty(b.qtyDone)} z ${iloscZJednostka(b.qtyDoc, b.unit)}",
                        fontSize = 14.sp,
                        color = Ink,
                    )
                }
            }

            /* NADMIAR stoi w podglądzie od audytu z 22 września 2026. Wcześniej
               zgłaszało go samo domknięcie po ostatniej pozycji, bez pokazania
               komukolwiek — a to też jest twierdzenie wobec dostawcy. */
            if (podsumowanie.nadmiary.isNotEmpty()) {
                NaglowekSekcjiZakonczenia("NADMIAR DO ZGŁOSZENIA (${podsumowanie.nadmiary.size})")
                Text(
                    "Odłożono więcej, niż jest na fakturze. Jeśli to pomyłka w liczeniu — " +
                        "wróć i popraw ilość, zanim zakończysz.",
                    fontSize = 13.sp,
                    color = InkSoft,
                )
                podsumowanie.nadmiary.forEach { n ->
                    Text(
                        "${n.sym} · ${formatQty(n.qtyDone)} przy ${iloscZJednostka(n.qtyDoc, n.unit)} z faktury",
                        fontSize = 14.sp,
                        color = Ink,
                    )
                }
            }

            if (saNietkniete) {
                NaglowekSekcjiZakonczenia("NIETKNIĘTE (${podsumowanie.nietkniete.size}) — WYBIERZ")
                podsumowanie.nietkniete.forEach { n ->
                    Text("${n.sym} · ${iloscZJednostka(n.qtyDoc, n.unit)}", fontSize = 14.sp, color = Ink)
                }
                WyborNietknietych(
                    tytul = "BRAK — NIE PRZYSZŁO",
                    opis = "Zgłoszenie „brak w przesyłce” na całą ilość; towar schodzi ze sprzedaży.",
                    wybrany = los == "brak",
                    onClick = { los = "brak" },
                )
                WyborNietknietych(
                    tytul = "POMIŃ — TOWAR JEST, ROZŁOŻĘ PÓŹNIEJ",
                    opis = "Bez zgłoszenia. Karta towaru pokaże je dalej jako „w dostawie”.",
                    wybrany = los == "pomin",
                    onClick = { los = "pomin" },
                )
            }

            PrimaryButton(
                when {
                    saNietkniete && los == null -> "WYBIERZ, CO Z NIETKNIĘTYMI"
                    zgloszen == 0 -> "ZAKOŃCZ DOSTAWĘ"
                    else -> "ZAKOŃCZ I ZGŁOŚ $zgloszen"
                },
                modifier = Modifier.fillMaxWidth(),
                enabled = !busy && (!saNietkniete || los != null),
                onClick = { onPotwierdz(if (saNietkniete) los else null) },
            )
            OutlineButton("WRÓĆ DO POZYCJI", modifier = Modifier.fillMaxWidth(), onClick = onCancel)
        }
    }
}

@Composable
private fun NaglowekSekcjiZakonczenia(tekst: String) {
    Text(tekst, fontSize = 13.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.1.sp, color = Ink)
}

/**
 * Jedna z dwóch odpowiedzi o nietkniętych — cały kafel jest celem dotyku.
 * Zaznaczenie niesie obrys i znak ✓, nie sam kolor (dekalog, punkt 7).
 */
@Composable
private fun WyborNietknietych(tytul: String, opis: String, wybrany: Boolean, onClick: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .cardSurface(
                background = if (wybrany) AmberBgSoft else CardWhite,
                borderColor = if (wybrany) Ink else CardBorder,
            )
            .heightIn(min = MinTap)
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Text(
            (if (wybrany) "✓ " else "") + tytul,
            fontFamily = BarlowCond,
            fontWeight = FontWeight.ExtraBold,
            fontSize = 16.sp,
            color = Ink,
        )
        Text(opis, fontSize = 13.sp, color = InkSoft)
    }
}

/** Ile zgłoszeń do dostawcy powstanie — ta sama liczba przed zapisem i po nim. */
private fun liczbaZgloszen(p: ZakonczenieDostawy, los: String?): Int =
    p.braki.size + p.nadmiary.size + if (los == "brak") p.nietkniete.size else 0

/** Zdanie po korekcie: ilość i — przy zerze — co stało się z półką. */
private fun opisKorekty(linia: DeliveryLineView, qty: Double, r: KorektaResponse): String = when (r.adres) {
    "przywrocony" -> "${linia.sym} · odłożone 0 — półka wraca do stanu sprzed dostawy"
    "zostaje" -> "${linia.sym} · odłożone 0 — w kartotece zostaje ${r.lok ?: "półka"}, popraw na karcie towaru"
    else -> "${linia.sym} · odłożone ${iloscZJednostka(qty, linia.unit)}"
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
    /* Wpisywanie zamiast klikania — ta sama droga co w panelu odkładania
       (0.113.0). Tu boli tak samo: poprawka setnej pozycji z dokumentu to sto
       stuknięć w `+`.

       BEZ GÓRNEJ GRANICY Z DOKUMENTU (audyt z 22 września 2026). Do tej wersji
       arkusz ucinał na ilości z faktury, a serwer od 0.64.0 wymaga czegoś
       odwrotnego: „skoro + wolno przekroczyć fakturę, korekta MUSI umieć to
       samo". Dwie reguły o jednej liczbie się wykluczały — realnego nadmiaru
       nie dało się wpisać korektą. Nadmiar i tak nie idzie nigdzie sam:
       pokazuje go podgląd ZAKOŃCZ. */
    var wpis by remember(line.id) { mutableStateOf<String?>(null) }
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
                Column(
                    modifier = Modifier
                        .weight(1f)
                        .clip(RoundedCornerShape(10.dp))
                        .clickable { wpis = formatQty(ile) },
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text(
                        iloscZJednostka(ile, line.unit),
                        fontFamily = BarlowCond,
                        fontWeight = FontWeight.ExtraBold,
                        fontSize = 32.sp,
                        color = Ink,
                    )
                    Text(
                        if (wpis == null) "z ${formatQty(line.qtyDoc)} na dokumencie · dotknij, aby wpisać"
                        else "z ${formatQty(line.qtyDoc)} na dokumencie",
                        fontSize = 11.sp,
                        color = InkMute,
                    )
                }
                KrokIlosci("+", true) { ile += 1 }
            }

            wpis?.let { w ->
                val fokus = remember(line.id) { FocusRequester() }
                LaunchedEffect(line.id) { fokus.requestFocus() }
                val liczba = iloscZWpisu(w)
                fun zatwierdz() {
                    val v = iloscZWpisu(w) ?: return
                    ile = v
                    wpis = null
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    WertisTextField(
                        value = w,
                        onValueChange = { wpis = it },
                        placeholder = "np. ${formatQty(line.qtyDoc)}",
                        keyboardType = KeyboardType.Number,
                        modifier = Modifier.weight(1f).focusRequester(fokus),
                        onDone = { zatwierdz() },
                    )
                    PrimaryButton("USTAW", enabled = liczba != null) { zatwierdz() }
                    OutlineButton("✕") { wpis = null }
                }
            }

            // co się stanie z pozycją po zapisie — mówimy wprost, bo status
            // przelicza serwer i sam skok „odłożone → do zrobienia" bez
            // uprzedzenia wygląda z hali jak skasowana praca
            Text(
                when {
                    ile > line.qtyDoc ->
                        "O ${iloscZJednostka(ile - line.qtyDoc, line.unit)} ponad fakturę — " +
                            "ZAKOŃCZ DOSTAWĘ pokaże to jako nadmiar do zgłoszenia."
                    ile >= line.qtyDoc -> "Pozycja zostanie odłożona w całości."
                    ile > 0.0 -> "Pozycja wróci na listę jako częściowo odłożona."
                    else -> "Pozycja wróci na listę jako nieodłożona."
                },
                fontSize = 13.sp,
                fontWeight = FontWeight.SemiBold,
                color = Ink,
            )
            Text(
                if (ile == 0.0) {
                    "Przy zerze półka wraca w kartotece do stanu sprzed tej dostawy, " +
                        "jeśli wiadomo, jaki był. To poprawka liczenia, nie zgłoszenie do dostawcy."
                } else {
                    "Adres, pod którym towar już leży, zostaje bez zmian. To poprawka " +
                        "liczenia w WERTIS, nie zgłoszenie do dostawcy."
                },
                fontSize = 13.sp,
                color = InkSoft,
            )

            PrimaryButton(
                "ZAPISZ ${iloscZJednostka(ile, line.unit)}",
                modifier = Modifier.fillMaxWidth(),
                enabled = !busy && ile != line.qtyDone,
                onClick = { onZapisz(ile) },
            )
            OutlineButton("WRÓĆ", modifier = Modifier.fillMaxWidth(), onClick = onCancel)
        }
    }
}

/* ── Drogi powrotu z pomyłki ────────────────────────────────────────────────
   ZGŁOSZENIE WŁAŚCICIELA: „jak już zaznaczyłem, że wszystko jest, a się
   pomyliłem, to nie mogę tego cofnąć". Reguły i granice stoją po stronie
   serwera (`services/cofanie-dostawy.ts`); tu jest tylko to, co widać.     */

/**
 * Po tylu milisekundach drugi odczyt tej samej etykiety półki to już nowy
 * skan, a nie dubel spustu. Dwie sekundy wystarczą na przytrzymany spust,
 * a nie przeszkadzają w odłożeniu dwóch pozycji z rzędu na tę samą półkę:
 * między nimi zawsze stoi skan towaru.
 */
private const val DUBEL_SKANU_MS = 2_000L

/** Co pokazuje pasek COFNIJ — gotowe napisy, bez liczenia w chwili rysowania. */
private data class OstatnieOdlozenie(
    val lineId: Long,
    val sym: String,
    /** Ilość z jednostką, np. „10" albo „12,5 m". */
    val ilosc: String,
    val polka: String,
)

/** Zdanie po cofnięciu: co się stało z ilością, z dostawą i z adresem. */
private fun opisCofniecia(sym: String, r: CofniecieOdlozeniaResponse): String = buildString {
    append("Cofnięto $sym — zeskanuj właściwą półkę")
    if (r.otwartaPonownie) append(" · dostawa znów otwarta")
    // adres już w Subiekcie wraca przez kolejkę — karta towaru pokaże go z opóźnieniem
    if (r.adres == "zapisany") append(" · stary adres wraca przez kolejkę")
}

/**
 * Pasek nad listą po odłożeniu: CO poszło i GDZIE, plus COFNIJ.
 *
 * Napis niesie liczbę, symbol i półkę, bo pomyłkę rozpoznaje się właśnie po
 * nich: „10, a miało być 3", „B02, a leży w B03". Cel 48 dp daje `OutlineButton`.
 */
@Composable
private fun PasekCofnij(
    ostatnie: OstatnieOdlozenie,
    busy: Boolean,
    onCofnij: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .cardSurface()
            .padding(start = 12.dp, end = 6.dp, top = 6.dp, bottom = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Column(Modifier.weight(1f)) {
            Text("ODŁOŻONO", fontSize = 12.sp, fontWeight = FontWeight.Bold, color = InkSoft)
            Text(
                "${ostatnie.ilosc} · ${ostatnie.sym} → ${ostatnie.polka}",
                fontFamily = BarlowCond,
                fontWeight = FontWeight.Bold,
                fontSize = 17.sp,
                color = Ink,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
        OutlineButton("COFNIJ", enabled = !busy, onClick = onCofnij)
    }
}

/**
 * Zmiana półki po odłożeniu — ilość zostaje, adres idzie na właściwą półkę.
 *
 * Arkusz ma WŁASNY handler skanów i stoi na stosie nad ekranem, więc skan
 * etykiety trafia tutaj, a nie do zwykłego odkładania. Kod towaru dostaje
 * odmowę zdaniem: w tym arkuszu skanuje się wyłącznie półkę.
 *
 * Pole wpisu NIE bierze fokusu samo. Z fokusem skaner klawiaturowy milknie,
 * a skan jest tu drogą pierwszą — wpis zostaje na zdartą etykietę.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ZmianaPolkiSheet(
    line: DeliveryLineView,
    locInfo: LocationsInfo?,
    allowManual: Boolean,
    busy: Boolean,
    onCancel: () -> Unit,
    onPolka: (kod: String, recznie: Boolean) -> Unit,
    onZlyKod: (String) -> Unit,
) {
    val zapisana = line.cofnij?.lok ?: line.locActual ?: "—"
    var wpis by remember(line.id) { mutableStateOf("") }

    ScanHandlerEffect { scan ->
        when {
            busy -> onZlyKod("Czekaj — zapisuję poprzednią zmianę")
            scan.kind == ScanKind.EAN -> onZlyKod("To kod towaru — zeskanuj etykietę półki")
            else -> {
                val kod = normalizeLoc(scan.code)
                val err = if (scan.kind == ScanKind.LOC) null else validateLoc(kod, locInfo)
                if (err != null) onZlyKod(err) else onPolka(kod, false)
            }
        }
        true
    }

    ModalBottomSheet(onDismissRequest = onCancel, containerColor = Paper) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text(
                "ZMIEŃ PÓŁKĘ",
                fontFamily = BarlowCond,
                fontWeight = FontWeight.ExtraBold,
                fontSize = 20.sp,
                color = Ink,
            )
            Text(line.sym, fontFamily = BarlowCond, fontWeight = FontWeight.Bold, fontSize = 16.sp, color = Ink)
            Text(line.name, fontSize = 13.sp, color = InkSoft, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text("Zapisana półka: $zapisana", fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = Ink)
            Text(
                "Zeskanuj etykietę półki, na której towar naprawdę leży.",
                fontSize = 18.sp,
                fontWeight = FontWeight.Bold,
                color = Ink,
            )
            Text(
                "Ilość zostaje bez zmian. Adres w kartotece przejdzie na nową półkę.",
                fontSize = 13.sp,
                color = InkSoft,
            )
            if (allowManual) {
                fun zatwierdz() {
                    val kod = normalizeLoc(wpis)
                    val err = validateLoc(kod, locInfo)
                    if (err != null) onZlyKod(err) else onPolka(kod, true)
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    WertisTextField(
                        value = wpis,
                        onValueChange = { wpis = it },
                        placeholder = "albo wpisz kod półki",
                        modifier = Modifier.weight(1f),
                        onDone = { zatwierdz() },
                    )
                    PrimaryButton("ZAPISZ", enabled = !busy && wpis.isNotBlank()) { zatwierdz() }
                }
            }
            OutlineButton("WRÓĆ", modifier = Modifier.fillMaxWidth(), onClick = onCancel)
        }
    }
}
