package pl.wertis.kolektor.nav

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import pl.wertis.kolektor.core.nav.Screen
import pl.wertis.kolektor.core.nav.backTarget
import pl.wertis.kolektor.data.RecentEntry
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

    fun backTargetOf(s: Screen): Screen? = backTarget(s, queueReturn)

    fun go(screen: Screen) {
        _screen.value = screen
    }

    fun goBack() {
        _screen.value = backTargetOf(_screen.value) ?: Screen.HOME
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
     * Czy ekran skanu ma DOŁOŻYĆ adres, czy przenieść towar.
     *
     * Bez tego rozróżnienia towar z jednym adresem nie mógł dostać drugiego:
     * skan zawsze szedł jako `REPLACE`, a arkusz z wyborem otwierał się dopiero
     * przy dwóch adresach — czyli przy stanie, do którego nie dało się dojść.
     */
    @Volatile var scanLocDodaj: Boolean = false; private set

    fun openScanLoc(dodaj: Boolean = false) {
        scanLocDodaj = dodaj
        go(Screen.SCAN_LOC)
    }

    fun openDelivery(id: Long) {
        deliveryId = id
        go(Screen.DELIVERY_LINES)
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
