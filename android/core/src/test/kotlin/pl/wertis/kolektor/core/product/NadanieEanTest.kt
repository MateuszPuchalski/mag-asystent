package pl.wertis.kolektor.core.product

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import pl.wertis.kolektor.core.scan.ScanConfig

/* Nadanie kodu ma trzy stany prowadzące w RÓŻNE strony i tylko dwa z nich da
   się przejść. Zlanie ich w jedno „na pewno?" byłoby najgorszym uproszczeniem:
   pytanie wygląda tak samo, a odpowiedź „tak" raz naprawia kartotekę, a raz
   psuje cudzą.                                                               */

class NadanieEanTest {

    private val cfg = ScanConfig.of(listOf("""^[A-J]\d{2}-\d{2}-\d{2}$""", """^PAL-\d{3}$"""))

    /* ── Walidacja ────────────────────────────────────────────────────────── */

    @Test fun `poprawne dlugosci kodu przechodza`() {
        for (ok in listOf("12345678", "123456789012", "5901234123457", "12345678901234")) {
            assertNull(ok, bladKoduEan(ok, cfg))
        }
    }

    @Test fun `ADRES REGALU NIE JEST KODEM TOWARU`() {
        /* Gdyby przeszedł, najbliższy skan tej etykiety zamieniłby półkę
           w towar — pomyłka niewidoczna, dopóki ktoś nie zauważy, że zniknął
           regał. Dlatego reguła jest ta sama co w klasyfikatorze skanu. */
        assertEquals("To jest adres regału, nie kod towaru", bladKoduEan("A01-02-03", cfg))
        assertEquals("To jest adres regału, nie kod towaru", bladKoduEan("PAL-042", cfg))
    }

    @Test fun `zla dlugosc jest odrzucana`() {
        for (zly in listOf("123", "1234567", "123456789012345")) {
            assertEquals("Kod ma mieć 8, 12, 13 albo 14 cyfr", bladKoduEan(zly, cfg))
        }
    }

    @Test fun `pusty kod prosi o skan`() {
        assertEquals("Zeskanuj albo wpisz kod kreskowy", bladKoduEan("", cfg))
        assertEquals("Zeskanuj albo wpisz kod kreskowy", bladKoduEan("   ", cfg))
    }

    /* ── Krok arkusza ─────────────────────────────────────────────────────── */

    @Test fun `bez kodu czekamy na skan`() {
        assertEquals(KrokEan.SKANUJ, krokEan(kod = "", eanKartoteki = ""))
    }

    @Test fun `puste pole to zwykle uzupelnienie`() {
        // nic nie ginie, więc nie ma o co pytać
        assertEquals(KrokEan.UZUPELNIJ, krokEan(kod = "5901234123457", eanKartoteki = ""))
    }

    @Test fun `kartoteka z kodem wymaga potwierdzenia podmiany`() {
        // stary kod zostaje na kartonach w hali i przestanie działać
        assertEquals(
            KrokEan.POTWIERDZ_PODMIANE,
            krokEan(kod = "5901234123457", eanKartoteki = "5900000000001"),
        )
    }

    @Test fun `ZAJETY WYGRYWA ZE WSZYSTKIM`() {
        /* Sedno tej klasy. Kod należący do innej kartoteki jest drogą zamkniętą
           — także wtedy, gdy pole tej kartoteki jest puste i wszystko inne
           wyglądałoby na zwykłe uzupełnienie. */
        assertEquals(
            KrokEan.ZAJETY,
            krokEan(kod = "5901234123457", eanKartoteki = "", zajetyPrzezInnego = true),
        )
        assertEquals(
            KrokEan.ZAJETY,
            krokEan(kod = "5901234123457", eanKartoteki = "5900000000001", zajetyPrzezInnego = true),
        )
    }

    /* ── Flaga potwierdzenia ──────────────────────────────────────────────── */

    @Test fun `potwierdzenie leci WYLACZNIE przy podmianie`() {
        /* Wysyłanie go zawsze znaczyłoby, że kolektor z góry zgadza się nadpisać
           kod, o którym jeszcze nie wie: gdyby ktoś nadał kod tej kartotece
           między otwarciem arkusza a zatwierdzeniem, serwer nadpisałby go bez
           pytania. */
        assertEquals(true, wymagaPotwierdzenia(KrokEan.POTWIERDZ_PODMIANE))
        assertEquals(false, wymagaPotwierdzenia(KrokEan.UZUPELNIJ))
        assertEquals(false, wymagaPotwierdzenia(KrokEan.SKANUJ))
        assertEquals(false, wymagaPotwierdzenia(KrokEan.ZAJETY))
    }
}
