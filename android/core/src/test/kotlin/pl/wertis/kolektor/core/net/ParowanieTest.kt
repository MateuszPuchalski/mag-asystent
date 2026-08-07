package pl.wertis.kolektor.core.net

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/* Lustro `server/src/services/parowanie.test.ts` — te same przypadki po obu
   stronach. Rozjazd znaczy kod QR, którego kolektor nie umie przeczytać, więc
   przypadki są tu przepisane celowo, a nie streszczone. */
class ParowanieTest {

    @Test
    fun `kod parowania rozwija sie w adres HTTP`() {
        assertEquals("http://192.168.1.50:3001", parsujKodParowania("wertis://192.168.1.50:3001"))
        assertEquals(
            "http://mag.wertis.local:3001",
            parsujKodParowania("wertis://mag.wertis.local:3001"),
        )
    }

    @Test
    fun `brak portu oznacza port domyslny`() {
        assertEquals("http://192.168.1.50:3001", parsujKodParowania("wertis://192.168.1.50"))
    }

    @Test
    fun `biale znaki wokol kodu nie przeszkadzaja`() {
        // skaner potrafi dokleić CR/LF na końcu — to nie jest inny kod
        assertEquals(
            "http://192.168.1.50:3001",
            parsujKodParowania("  wertis://192.168.1.50:3001\r\n"),
        )
    }

    @Test
    fun `wielkosc liter w schemacie nie ma znaczenia`() {
        assertEquals("http://192.168.1.50:3001", parsujKodParowania("WERTIS://192.168.1.50:3001"))
    }

    @Test
    fun `cokolwiek innego niz kod parowania jest odrzucane`() {
        val nie = listOf(
            "A01-02-03",                              // adres regału
            "W32-0203",                               // symbol towaru
            "5901234123457",                          // EAN
            "http://192.168.1.50:3001",               // zwykły URL
            "wertis://",                              // sam schemat
            "wertis://192.168.1.50:3001/api/health",  // ze ścieżką
            "wertis://user:haslo@192.168.1.50:3001",  // z danymi logowania
            "wertis://192.168.1.50:99999",            // port poza zakresem
            "wertis://192.168.1.50:3001?x=1",         // z zapytaniem
            "wertis://192.168.1.50 evil.example.com", // dwa hosty
        )
        nie.forEach { assertNull(it, parsujKodParowania(it)) }
    }

    @Test
    fun `haslo wpisane przy otwartym parowaniu nie jest kodem`() {
        /* Ekran startowy zbiera skan także wtedy, gdy ktoś pisze hasło na
           klawiaturze sprzętowej. Cokolwiek nie zaczyna się od schematu, ma
           tu zniknąć — i ten test jest o tym, a nie o formacie. */
        listOf("tajnehaslo", "Haslo123!", "jkowalski").forEach {
            assertNull(parsujKodParowania(it))
            assertFalse(czyKodParowania(it))
        }
    }

    @Test
    fun `rozpoznanie kodu parowania nie zalezy od poprawnosci reszty`() {
        // „to miał być kod parowania, ale jest zepsuty" != „to nie kod parowania"
        assertTrue(czyKodParowania("wertis://192.168.1.50:99999"))
        assertNull(parsujKodParowania("wertis://192.168.1.50:99999"))
    }

    @Test
    fun `opis adresu zdejmuje protokol`() {
        assertEquals("192.168.1.50:3001", opisAdresu("http://192.168.1.50:3001"))
    }

    /* ── Odpowiedź na rozgłoszenie ─────────────────────────────────────────
       Jedyne miejsce, w którym kolektor bierze dane wprost z sieci, od
       kogokolwiek, kto odpowiedział. Wszystko poza poprawną odpowiedzią ma
       tu zniknąć, a nie stać się adresem serwera.                          */

    @Test
    fun `poprawna odpowiedz staje sie znalezionym serwerem`() {
        val s = zinterpretujOdpowiedz(
            """{"wertis":1,"adres":"wertis://192.168.1.50:3001","wersja":"0.29.0"}"""
        )
        assertEquals("http://192.168.1.50:3001", s?.url)
        assertEquals("0.29.0", s?.wersja)
    }

    @Test
    fun `brak wersji w odpowiedzi nie unieważnia serwera`() {
        val s = zinterpretujOdpowiedz("""{"wertis":1,"adres":"wertis://192.168.1.50:3001"}""")
        assertEquals("http://192.168.1.50:3001", s?.url)
        assertNull(s?.wersja)
    }

    @Test
    fun `smiec z sieci nie staje sie adresem serwera`() {
        val smieci = listOf(
            "",                                                   // pusty pakiet
            "nie-json",                                           // nie JSON
            """{"wertis":0,"adres":"wertis://192.168.1.50:3001"}""", // cudza usługa UDP
            """{"wertis":1}""",                                   // bez adresu
            """{"wertis":1,"adres":null}""",
            """{"wertis":1,"adres":"http://zly.example.com"}""",   // zły schemat
            """{"wertis":1,"adres":"wertis://zly.example.com/api"}""", // ze ścieżką
            """{"wertis":1,"adres":"wertis://a:0"}""",             // port poza zakresem
            """{"adres":"wertis://192.168.1.50:3001"}""",          // bez znacznika
        )
        smieci.forEach { assertNull(it, zinterpretujOdpowiedz(it)) }
    }

    @Test
    fun `nadmiarowe pola w odpowiedzi nie wywracaja odczytu`() {
        // nowszy serwer może dołożyć pole; starszy kolektor ma dalej działać
        val s = zinterpretujOdpowiedz(
            """{"wertis":1,"adres":"wertis://192.168.1.50:3001","magazyn":"MAG","x":[1,2]}"""
        )
        assertEquals("http://192.168.1.50:3001", s?.url)
    }
}
