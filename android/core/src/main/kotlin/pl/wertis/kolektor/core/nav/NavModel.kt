package pl.wertis.kolektor.core.nav

/* ── Model nawigacji ────────────────────────────────────────────────────────
   Port web/src/lib/store.ts: nawigacja to statyczna mapa POWROTÓW (nie stos),
   plus specjalny przypadek kolejki (queueReturn — ekran, z którego otwarto). */

enum class Screen {
    SPLASH, HOME, PRODUCT, SCAN_LOC, QUEUE,
    // tryb A (dostawy krajowe i zwroty) — dokument jest jednostką pracy
    DELIVERY_DOCS, DELIVERY_LINES,
    // tryb B (kontener importowy) — sesja z wózkiem, schowany za osobnym wejściem
    PUTAWAY_DOCS, PUTAWAY_SESSION, LOCATION, SETTINGS,
    // wyjątki: nierozwiązane zgłoszenia + kolizje EAN do naprawy w kartotece
    PROBLEMS,
}

private val BACK: Map<Screen, Screen> = mapOf(
    Screen.PRODUCT to Screen.HOME,
    Screen.SCAN_LOC to Screen.PRODUCT,
    Screen.DELIVERY_LINES to Screen.DELIVERY_DOCS,
    Screen.PUTAWAY_DOCS to Screen.DELIVERY_DOCS,
    Screen.PUTAWAY_SESSION to Screen.PUTAWAY_DOCS,
    Screen.LOCATION to Screen.HOME,
    Screen.SETTINGS to Screen.HOME,
    Screen.PROBLEMS to Screen.HOME,
)

/** Cel przycisku wstecz; null = brak (splash/home/putawayDocs pokazują logo). */
fun backTarget(screen: Screen, queueReturn: Screen?): Screen? =
    if (screen == Screen.QUEUE) queueReturn ?: Screen.HOME else BACK[screen]

/** Tytuły ekranów w pasku górnym (pl). */
val SCREEN_TITLES: Map<Screen, String> = mapOf(
    Screen.HOME to "SKAN / SZUKAJ",
    Screen.PRODUCT to "KARTA TOWARU",
    Screen.SCAN_LOC to "ZMIANA LOKALIZACJI",
    Screen.QUEUE to "KOLEJKA SFERY",
    Screen.DELIVERY_DOCS to "ROZKŁADANIE",
    Screen.DELIVERY_LINES to "DOSTAWA",
    Screen.PUTAWAY_DOCS to "KONTENERY",
    Screen.PUTAWAY_SESSION to "SESJA ROZKŁADANIA",
    Screen.LOCATION to "LOKALIZACJA",
    Screen.SETTINGS to "USTAWIENIA",
    Screen.PROBLEMS to "WYJĄTKI",
)
