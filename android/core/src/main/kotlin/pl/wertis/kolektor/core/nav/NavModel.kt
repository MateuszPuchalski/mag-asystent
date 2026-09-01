package pl.wertis.kolektor.core.nav

/* ── Model nawigacji ────────────────────────────────────────────────────────
   Port web/src/lib/store.ts: nawigacja to statyczna mapa POWROTÓW (nie stos),
   plus specjalny przypadek kolejki (queueReturn — ekran, z którego otwarto). */

enum class Screen {
    SPLASH, HOME, PRODUCT, SCAN_LOC, QUEUE,
    // rozkładanie: dokument jest jednostką pracy — także dla kontenerów z MGP,
    // po których zostaje jeszcze przesunięcie stanu (arkusz, nie ekran)
    DELIVERY_DOCS, DELIVERY_LINES,
    // rozkładanie ZWROTÓW: PRZYJECIA to korzeń własnej zakładki (lista koszy
    // z kartkami), KOSZ_LINES to wejście w konkretny kosz
    PRZYJECIA, KOSZ_LINES,
    // KARTON: towar źle zebrany, odłożony przez pakujących do jednego pudła.
    // KARTONY to korzeń zakładki, KARTON to jedno pudło — najpierw zbierane
    // skanem, po zatwierdzeniu rozkładane jak kosz (ten sam ekran niżej)
    KARTONY, KARTON,
    LOCATION, SETTINGS,
    // wyjątki: nierozwiązane zgłoszenia + kolizje EAN do naprawy w kartotece
    PROBLEMS,
    // zadania pomiarowe i weryfikacje z panelu obsługi klienta
    FIELD_TASKS,
    // zakładanie kont: pierwsze uruchomienie ORAZ dopisywanie osób przez biuro
    SETUP,
}

private val BACK: Map<Screen, Screen> = mapOf(
    Screen.PRODUCT to Screen.HOME,
    Screen.SCAN_LOC to Screen.PRODUCT,
    Screen.DELIVERY_LINES to Screen.DELIVERY_DOCS,
    Screen.KOSZ_LINES to Screen.PRZYJECIA,
    Screen.KARTON to Screen.KARTONY,
    Screen.LOCATION to Screen.HOME,
    Screen.SETTINGS to Screen.HOME,
    Screen.PROBLEMS to Screen.HOME,
    Screen.FIELD_TASKS to Screen.HOME,
    // z kreatora wraca się do ustawień; przy pustej instalacji nie ma dokąd
    Screen.SETUP to Screen.SETTINGS,
)

/** Cel przycisku wstecz; null = brak (splash i home pokazują logo). */
fun backTarget(screen: Screen, queueReturn: Screen?): Screen? =
    if (screen == Screen.QUEUE) queueReturn ?: Screen.HOME else BACK[screen]

/** Tytuły ekranów w pasku górnym (pl). */
val SCREEN_TITLES: Map<Screen, String> = mapOf(
    Screen.HOME to "SKAN / SZUKAJ",
    Screen.PRODUCT to "KARTA TOWARU",
    // ekran ma od 0.41.0 jedno znaczenie — dokłada adres, nie zastępuje
    Screen.SCAN_LOC to "DODANIE LOKALIZACJI",
    Screen.QUEUE to "KOLEJKA SFERY",
    Screen.DELIVERY_DOCS to "DOSTAWY",
    Screen.DELIVERY_LINES to "DOSTAWA",
    Screen.PRZYJECIA to "ROZKŁADANIE ZWROTÓW",
    Screen.KOSZ_LINES to "KOSZ ZWROTÓW",
    Screen.KARTONY to "KARTONY",
    Screen.KARTON to "KARTON",
    Screen.LOCATION to "LOKALIZACJA",
    Screen.SETTINGS to "USTAWIENIA",
    Screen.PROBLEMS to "WYJĄTKI",
    Screen.FIELD_TASKS to "ZADANIA Z BIURA",
    Screen.SETUP to "KONTA",
)
