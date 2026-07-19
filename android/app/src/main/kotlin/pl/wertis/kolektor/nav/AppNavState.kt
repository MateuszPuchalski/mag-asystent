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

    @Volatile var curId: Long? = null; private set
    @Volatile var sessionId: Long? = null; private set
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
        curId = id
        _screen.value = Screen.PRODUCT
    }

    fun openScanLoc() = go(Screen.SCAN_LOC)
    fun openMM() = go(Screen.MM)

    fun openSession(id: Long) {
        sessionId = id
        _screen.value = Screen.PUTAWAY_SESSION
    }

    fun openLocation(code: String) {
        locCode = code.trim().uppercase()
        _screen.value = Screen.LOCATION
    }

    fun openSettings() = go(Screen.SETTINGS)

    fun start() = go(Screen.HOME) // Splash: „Kto pracuje?” → home
}
