package pl.wertis.kolektor.core.product

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/* Reguły cache'u zdjęć. Najważniejszy test w tym pliku to ten, który sprawdza,
   że przy świeżym pliku NIE MA żądania — karta towaru jest odpytywana co 2 s
   i bez tej reguły zdjęcie jechałoby przez Wi-Fi po kilkanaście razy na minutę
   z każdego kolektora stojącego przy regale. */

private const val TERAZ = 1_700_000_000_000L

class ZdjecieCacheTest {

    @Test
    fun `brak wpisu znaczy pobierz`() {
        assertEquals(DecyzjaZdjecia.Pobierz, decyzja(null, maPlik = false, teraz = TERAZ))
    }

    @Test
    fun `swiezy wpis z plikiem NIE generuje zadania`() {
        val w = WpisZdjecia(etag = "abc", sprawdzono = TERAZ - 60_000)
        assertEquals(DecyzjaZdjecia.UzyjLokalnego, decyzja(w, maPlik = true, teraz = TERAZ))
    }

    @Test
    fun `po czasie swiezosci rewaliduje z ETagiem`() {
        val w = WpisZdjecia(etag = "abc", sprawdzono = TERAZ - SWIEZOSC_MS - 1)
        assertEquals(DecyzjaZdjecia.Rewaliduj("abc"), decyzja(w, maPlik = true, teraz = TERAZ))
    }

    @Test
    fun `wpis bez pliku pobiera od zera, choćby byl swiezy`() {
        // eviction wyprzedził odczyt albo ktoś wyczyścił dane aplikacji
        val w = WpisZdjecia(etag = "abc", sprawdzono = TERAZ)
        assertEquals(DecyzjaZdjecia.Pobierz, decyzja(w, maPlik = false, teraz = TERAZ))
    }

    @Test
    fun `wpis bez ETaga pobiera zamiast rewalidowac`() {
        val w = WpisZdjecia(etag = "", sprawdzono = TERAZ - SWIEZOSC_MS - 1)
        assertEquals(DecyzjaZdjecia.Pobierz, decyzja(w, maPlik = true, teraz = TERAZ))
    }

    // ── Negatyw ─────────────────────────────────────────────────────────────

    @Test
    fun `potwierdzony brak zdjecia oszczedza zadanie przez dobe`() {
        val w = WpisZdjecia(brak = true, sprawdzono = TERAZ - 60_000)
        assertEquals(DecyzjaZdjecia.NieMa, decyzja(w, maPlik = false, teraz = TERAZ))
    }

    @Test
    fun `po dobie brak jest sprawdzany ponownie`() {
        // zdjęcie DODANE dziś w Subiekcie ma się pojawić najdalej jutro
        val w = WpisZdjecia(brak = true, sprawdzono = TERAZ - NEGATYW_MS - 1)
        assertEquals(DecyzjaZdjecia.Pobierz, decyzja(w, maPlik = false, teraz = TERAZ))
    }

    // ── Eviction ────────────────────────────────────────────────────────────

    @Test
    fun `wypada najdawniej UZYTE, nie najdawniej pobrane`() {
        val wpisy = mapOf(
            1L to WpisZdjecia(bajtow = 600_000, sprawdzono = TERAZ - 100_000, uzyto = TERAZ),
            2L to WpisZdjecia(bajtow = 600_000, sprawdzono = TERAZ, uzyto = TERAZ - 100_000),
        )
        assertEquals(listOf(2L), doUsuniecia(wpisy, limitBajtow = 1_000_000, limitWpisow = 100))
    }

    @Test
    fun `mieszczac sie w limitach nie usuwa niczego`() {
        val wpisy = mapOf(1L to WpisZdjecia(bajtow = 1000, uzyto = TERAZ))
        assertTrue(doUsuniecia(wpisy, limitBajtow = 1_000_000, limitWpisow = 100).isEmpty())
    }

    @Test
    fun `wpisy o braku zdjecia nie licza sie do limitu bajtow`() {
        // kasowanie ich przy nadmiarze bajtów wyrzucałoby wiedzę, która
        // oszczędza najwięcej żądań — a miejsca nie zajmują wcale
        val wpisy = mapOf(
            1L to WpisZdjecia(bajtow = 900_000, uzyto = TERAZ),
            2L to WpisZdjecia(brak = true, uzyto = TERAZ - 100_000),
        )
        assertTrue(doUsuniecia(wpisy, limitBajtow = 2_000_000, limitWpisow = 100).isEmpty())
    }

    @Test
    fun `limit sztuk dziala takze na wpisach o braku zdjecia`() {
        val wpisy = (1L..5L).associateWith { WpisZdjecia(brak = true, uzyto = TERAZ - it * 1000) }
        val usun = doUsuniecia(wpisy, limitBajtow = 1_000_000, limitWpisow = 3)
        assertEquals(2, usun.size)
        assertEquals(listOf(5L, 4L), usun, "najdawniej używane najpierw")
    }
}
