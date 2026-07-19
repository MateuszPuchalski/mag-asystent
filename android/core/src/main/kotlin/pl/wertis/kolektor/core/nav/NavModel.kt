package pl.wertis.kolektor.core.nav

/* ── Model nawigacji ────────────────────────────────────────────────────────
   Port web/src/lib/store.ts: nawigacja to statyczna mapa POWROTÓW (nie stos),
   plus specjalny przypadek kolejki (queueReturn — ekran, z którego otwarto). */

enum class Screen {
    SPLASH, HOME, PRODUCT, SCAN_LOC, MM, QUEUE,
    PUTAWAY_DOCS, PUTAWAY_SESSION, LOCATION, SETTINGS,
}

private val BACK: Map<Screen, Screen> = mapOf(
    Screen.PRODUCT to Screen.HOME,
    Screen.SCAN_LOC to Screen.PRODUCT,
    Screen.MM to Screen.PRODUCT,
    Screen.PUTAWAY_SESSION to Screen.PUTAWAY_DOCS,
    Screen.LOCATION to Screen.HOME,
    Screen.SETTINGS to Screen.HOME,
)

/** Cel przycisku wstecz; null = brak (splash/home/putawayDocs pokazują logo). */
fun backTarget(screen: Screen, queueReturn: Screen?): Screen? =
    if (screen == Screen.QUEUE) queueReturn ?: Screen.HOME else BACK[screen]

/** Tytuły ekranów w pasku górnym (pl). */
val SCREEN_TITLES: Map<Screen, String> = mapOf(
    Screen.HOME to "SKAN / SZUKAJ",
    Screen.PRODUCT to "KARTA TOWARU",
    Screen.SCAN_LOC to "ZMIANA LOKALIZACJI",
    Screen.MM to "MM MGP→MAG",
    Screen.QUEUE to "KOLEJKA SFERY",
    Screen.PUTAWAY_DOCS to "ROZKŁADANIE",
    Screen.PUTAWAY_SESSION to "SESJA ROZKŁADANIA",
    Screen.LOCATION to "LOKALIZACJA",
    Screen.SETTINGS to "USTAWIENIA",
)
