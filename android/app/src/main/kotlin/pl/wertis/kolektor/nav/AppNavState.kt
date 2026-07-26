package pl.wertis.kolektor.nav

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import pl.wertis.kolektor.core.nav.Screen
import pl.wertis.kolektor.core.nav.backTarget
import pl.wertis.kolektor.data.RecentEntry
import pl.wertis.kolektor.data.RecentStore

/* ── Nawigacja UI — port web/src/lib/store.ts ───────────────────────────────
   Statyczna mapa powrotów (nie stos) + parametry kontekstu jak w PWA:
   curId (towar), sessionId (rozkładanie), locCode (podgląd lokalizacji),
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
    @Volatile var sessionId: Long? = null; private set
    /** Tryb A: otwarta dostawa albo zwrot (dokument = jednostka pracy). */
    @Volatile var deliveryId: Long? = null; private set
    @Volatile var locCode: String? = null; private set
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

    fun openScanLoc() = go(Screen.SCAN_LOC)

    fun openDelivery(id: Long) {
        deliveryId = id
        go(Screen.DELIVERY_LINES)
    }

    fun openSession(id: Long) {
        sessionId = id
        _screen.value = Screen.PUTAWAY_SESSION
    }

    fun openLocation(code: String) {
        locCode = code.trim().uppercase()
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
        sessionId != null -> "sesja kontenerowa #" + sessionId
        locCode != null -> "regał " + locCode
        else -> null
    }
}
