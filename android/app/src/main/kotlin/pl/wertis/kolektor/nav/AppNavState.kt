package pl.wertis.kolektor.nav

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import pl.wertis.kolektor.core.nav.Screen
import pl.wertis.kolektor.core.nav.backTarget
import pl.wertis.kolektor.core.nav.ekranDoOpuszczenia
import pl.wertis.kolektor.core.nav.wracacNaGlowny
import pl.wertis.kolektor.core.recent.RecentEntry
import pl.wertis.kolektor.data.RecentStore

/* ── Nawigacja UI — port web/src/lib/store.ts ───────────────────────────────
   Statyczna mapa powrotów (nie stos) + parametry kontekstu jak w PWA:
   curId (towar), deliveryId (rozkładanie), locCode (podgląd lokalizacji),
   queueReturn (skąd otwarto kolejkę).                                        */

class AppNavState(private val recentStore: RecentStore) {
    private val _screen = MutableStateFlow(Screen.SPLASH)
    val screen: StateFlow<Screen> = _screen

    /* curId JEST obserwowalny, i to nie jest ozdoba. `openProduct` przy otwartej
       karcie ustawia `_screen` na tę samą wartość, a StateFlow zgniata równe
       wartości — więc przejście towar→towar nie emitowało NICZEGO. Karta
       zmieniała się dopiero przy przypadkowej rekompozycji z innego powodu
       (kolejka, toast, licznik offline), czyli czasem. To dlatego obietnica
       z dołu karty („skan towaru = następna karta") działała losowo. */
    private val _curId = MutableStateFlow<Long?>(null)
    val curIdFlow: StateFlow<Long?> = _curId
    val curId: Long? get() = _curId.value
    /** Tryb A: otwarta faktura zakupu (dokument = jednostka pracy). */
    @Volatile var deliveryId: Long? = null; private set
    @Volatile var koszId: Long? = null; private set

    /* locCode jest obserwowalny z DOKŁADNIE tego samego powodu co `curId`
       wyżej — i był to ten sam błąd, tylko nienaprawiony. Skan regału przy
       otwartym podglądzie innego regału ustawia `_screen` na LOCATION, czyli
       na wartość, którą ekran już ma; StateFlow zgniata równe wartości, więc
       nie leciała żadna emisja, a `LocationScreen` czytał kod do bezkluczowego
       `remember` — raz, przy pierwszym wejściu. Efekt na sprzęcie: skanujesz
       drugi regał i NIC SIĘ NIE DZIEJE. */
    private val _locCode = MutableStateFlow<String?>(null)
    val locCodeFlow: StateFlow<String?> = _locCode
    val locCode: String? get() = _locCode.value
    @Volatile var queueReturn: Screen? = null; private set

    /** Skan-tekst z fallbacku, który dał wiele wyników — Home podstawia do wyszukiwarki. */
    @Volatile var pendingSearch: String? = null

    /**
     * Towar do zaznaczenia po wejściu na listę pozycji dostawy (0.71.0).
     *
     * Ten sam wzorzec co `pendingSearch`: parametr wejściowy ekranu podany
     * przez wołającego i KONSUMOWANY przy wejściu. Nie da się go przekazać
     * inaczej, bo aktywna pozycja jest stanem composable'a
     * (`remember(id)` w `DeliveryLinesScreen`), a nie polem nawigacji.
     *
     * Wskazujemy `twId`, nie `lineId`, i to jest decyzja: wiersz dostawy
     * powstaje dopiero przy OTWARCIU dokumentu, więc w chwili kliknięcia na
     * karcie towaru jeszcze go nie ma. Kartoteka jest tu jedynym trwałym
     * identyfikatorem.
     */
    @Volatile var pendingLineTwId: Long? = null

    fun backTargetOf(s: Screen): Screen? = backTarget(s, queueReturn)

    fun go(screen: Screen) {
        _screen.value = screen
    }

    fun goBack() {
        _screen.value = backTargetOf(_screen.value) ?: Screen.HOME
    }

    /**
     * Powrót na ekran główny po przerwie w tle (0.38.0).
     *
     * Reguła i jej powód mieszkają w `:core` (`PowrotDoPracy.kt`) — tu zostaje
     * samo przestawienie ekranu. Zwraca `true`, gdy faktycznie wróciliśmy;
     * wołający pokazuje wtedy komunikat, bo ekran zmieniony bez udziału
     * człowieka wygląda jak awaria, dopóki nie powie się, dlaczego.
     */
    fun wrocNaGlownyPoPrzerwie(wTleOd: Long?, teraz: Long = System.currentTimeMillis()): Boolean {
        if (!wracacNaGlowny(wTleOd, teraz)) return false
        if (!ekranDoOpuszczenia(_screen.value)) return false
        _screen.value = Screen.HOME
        return true
    }

    /** Otwarcie kolejki Sfery z zapamiętaniem ekranu powrotu (pastylka statusu). */
    fun openQueue() {
        if (_screen.value == Screen.QUEUE) return
        queueReturn = _screen.value
        _screen.value = Screen.QUEUE
    }

    fun openProduct(id: Long, meta: RecentEntry? = null) {
        if (meta != null) recentStore.push(meta.copy(id = id))
        _curId.value = id
        _screen.value = Screen.PRODUCT
    }

    /**
     * Ekran skanu półki — WYŁĄCZNIE dokładanie adresu.
     *
     * Do 0.41.0 miał dwa tryby, bo prowadziły tu dwa przyciski: „+ DODAJ"
     * dokładał, „ZMIEŃ LOKALIZACJĘ" zastępował. Ten drugi wyszedł jako
     * duplikat skanu półki na karcie, a razem z nim tryb zastępowania: nie
     * miał już ani jednego wołającego, a flaga bez wołającego to przełącznik
     * udający wybór.
     *
     * Przeprowadzkę robi się skanem półki przy otwartej karcie — przy jednym
     * adresie zastępuje od razu, przy kilku pyta arkuszem.
     */
    fun openScanLoc() = go(Screen.SCAN_LOC)

    /**
     * @param zaznaczTwId towar, którego pozycja ma być otwarta od razu.
     *   Wchodzi tędy wejście z karty towaru („W dostawie …"), gdzie człowiek
     *   wskazał konkretny towar i nie chce go szukać drugi raz na liście.
     */
    fun openDelivery(id: Long, zaznaczTwId: Long? = null) {
        deliveryId = id
        pendingLineTwId = zaznaczTwId
        go(Screen.DELIVERY_LINES)
    }

    fun openKosz(id: Long) {
        koszId = id
        go(Screen.KOSZ_LINES)
    }

    /** Wyjście z ROZŁOŻONEGO kosza — jak `zakonczonaDostawa`, ten sam powód. */
    fun zakonczonyKosz() {
        koszId = null
        go(Screen.PRZYJECIA)
    }

    /**
     * Wyjście z ZAKOŃCZONEJ dostawy: na listę dokumentów i bez kontekstu pracy.
     *
     * Osobno od `goBack()`, bo `deliveryId` czyta `opisPracy()` — pytanie
     * „przejąć pracę?" i ślad w audycie. Po domknięciu dostawy nie ma już
     * czego przejmować, a pole trzymane dalej meldowałoby pracę, której nie
     * ma. Zwykły `goBack()` tego pola NIE zeruje i nie powinien: z ekranu
     * pozycji wchodzi się w kartę towaru, która przy powrocie tego kontekstu
     * potrzebuje.
     */
    fun zakonczonaDostawa() {
        deliveryId = null
        go(Screen.DELIVERY_DOCS)
    }

    fun openLocation(code: String) {
        _locCode.value = code.trim().uppercase()
        _screen.value = Screen.LOCATION
    }

    fun openSettings() = go(Screen.SETTINGS)

    /**
     * Czy kreator kont działa na PUSTEJ instalacji.
     *
     * Rozstrzyga dwie rzeczy naraz: czy pierwsze konto idzie bez sesji i czy
     * lista musi zawierać biuro. Ustawiane przy wejściu, bo w środku kreatora
     * odpowiedź nie może się zmienić — inaczej w połowie wpisywania zmieniłyby
     * się reguły walidacji.
     */
    @Volatile var setupOdZera: Boolean = false; private set

    fun openSetup(odZera: Boolean) {
        setupOdZera = odZera
        go(Screen.SETUP)
    }

    fun openProblems() = go(Screen.PROBLEMS)

    fun start() = go(Screen.HOME) // Splash: „Zeskanuj badge" → home

    /**
     * Krótki opis TRWAJĄCEJ pracy — do pytania o przejęcie i do audytu.
     *
     * „Przejąć pracę?" bez powiedzenia JAKĄ jest pytaniem, na które nie da się
     * odpowiedzieć: człowiek stojący przy kolektorze widzi ekran, ale ten, kto
     * będzie czytał `events` za miesiąc, nie zobaczy nic. `null`, gdy nic nie
     * jest otwarte — wtedy przejęcie jest zwykłą zmianą osoby.
     */
    fun opisPracy(): String? = when {
        deliveryId != null -> "dostawa #" + deliveryId
        locCode != null -> "regał " + locCode
        else -> null
    }
}
