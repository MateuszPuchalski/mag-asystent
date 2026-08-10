package pl.wertis.kolektor.core.nav

import org.junit.Assert.assertEquals
import org.junit.Test

/* Reguła powstała po zgłoszeniu, w którym ekran przetrwał przerwę i zamienił
   skan półki w zmianę lokalizacji kartoteki. Testowana poza Androidem, bo
   zielony build `:app` nie odróżni progu dwóch minut od progu dwóch sekund —
   a to jest cała treść tej reguły.                                           */

class PowrotDoPracyTest {

    private val minuta = 60_000L

    @Test fun `bez przerwy nie ma powrotu`() {
        // aplikacja nigdy nie poszła w tło
        assertEquals(false, wracacNaGlowny(wTleOd = null, teraz = 1_000_000))
    }

    @Test fun `krotkie przelaczenie zostawia ekran`() {
        /* Zerknięcie w inną aplikację na kilkanaście sekund pamięta się zawsze,
           a wyrzucenie z rozgrzebanej dostawy karałoby rytm pracy za czynność
           bez ryzyka. */
        assertEquals(false, wracacNaGlowny(wTleOd = 0, teraz = 15_000))
        assertEquals(false, wracacNaGlowny(wTleOd = 0, teraz = 90_000))
    }

    @Test fun `DWUDZIESTOMINUTOWA PRZERWA WRACA NA GLOWNY`() {
        // dokładnie przypadek ze zgłoszenia
        assertEquals(true, wracacNaGlowny(wTleOd = 0, teraz = 20 * minuta))
    }

    @Test fun `prog jest osiagniety, nie przekroczony`() {
        assertEquals(true, wracacNaGlowny(wTleOd = 0, teraz = PROG_POWROTU_MS))
        assertEquals(false, wracacNaGlowny(wTleOd = 0, teraz = PROG_POWROTU_MS - 1))
    }

    @Test fun `ZEGAR COFNIETY TRAKTUJEMY JAK DLUGA PRZERWE`() {
        /* Synchronizacja czasu albo zmiana strefy potrafi cofnąć zegar.
           Ujemna przerwa nie jest „krótka" — jest NIEZNANA, a przy nieznanej
           wybieramy stronę bezpieczną. */
        assertEquals(true, wracacNaGlowny(wTleOd = 10 * minuta, teraz = 0))
    }

    @Test fun `wlasny prog dziala`() {
        // dwie minuty są założeniem z jednego zgłoszenia, nie pomiarem
        assertEquals(true, wracacNaGlowny(wTleOd = 0, teraz = 30_000, prog = 10_000))
        assertEquals(false, wracacNaGlowny(wTleOd = 0, teraz = 30_000, prog = 60_000))
    }

    /* ── Z których ekranów wracamy ────────────────────────────────────────── */

    @Test fun `ekrany reagujace na skan wracaja na glowny`() {
        for (s in listOf(
            Screen.PRODUCT, Screen.SCAN_LOC, Screen.DELIVERY_LINES,
            Screen.LOCATION, Screen.DELIVERY_DOCS, Screen.QUEUE,
            Screen.SETTINGS, Screen.PROBLEMS,
        )) {
            assertEquals(s.name, true, ekranDoOpuszczenia(s))
        }
    }

    @Test fun `glowny i splash nie maja dokad wracac`() {
        assertEquals(false, ekranDoOpuszczenia(Screen.HOME))
        assertEquals(false, ekranDoOpuszczenia(Screen.SPLASH))
    }

    @Test fun `KREATOR KONT ZOSTAJE`() {
        /* Formularz z wpisanymi danymi — wyrzucenie z niego kasowałoby pracę.
           Zakładanie konta nie reaguje na skan półki, więc nie niesie ryzyka,
           przed którym cała ta reguła chroni. */
        assertEquals(false, ekranDoOpuszczenia(Screen.SETUP))
    }
}
