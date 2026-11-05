package pl.wertis.kolektor.core.zgloszenie

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import pl.wertis.kolektor.core.nav.Screen
import pl.wertis.kolektor.core.net.WertisJson
import pl.wertis.kolektor.core.net.ZgloszenieBody
import pl.wertis.kolektor.core.net.ZgloszenieResponse
import java.util.Base64

/* Ciało żądania psuje się po cichu: ekran wygląda dobrze, a serwer odmawia
   dopiero na hali. Testy pilnują kształtu z kontraktu i limitów zdjęć. */

class ZgloszeniePracownikaTest {

    @Test fun `klucze rodzajow sa dokladnie te z kontraktu`() {
        assertEquals(
            listOf("pomysl", "przeszkadza", "blad"),
            RodzajZgloszenia.entries.map { it.klucz },
        )
    }

    @Test fun `zrodlo kolektor jedzie w JSON mimo encodeDefaults false`() {
        // WertisJson pomija pola równe domyślnej, więc tu łatwo o ciche zgubienie
        val body = zgloszenieKolektora(RodzajZgloszenia.BLAD, " Nie drukuje ", "PRODUCT", "0.618.0", emptyList())
        val json = WertisJson.encodeToString(ZgloszenieBody.serializer(), body)
        assertTrue(json, json.contains("\"zrodlo\":\"kolektor\""))
        assertTrue(json, json.contains("\"rodzaj\":\"blad\""))
        assertTrue(json, json.contains("\"opis\":\"Nie drukuje\""))
        assertTrue(json, json.contains("\"ekran\":\"PRODUCT\""))
        assertTrue(json, json.contains("\"wersja\":\"0.618.0\""))
        // pusta lista zdjęć nie jedzie wcale — pole jest opcjonalne
        assertFalse(json, json.contains("zdjecia"))
    }

    @Test fun `zdjecia jada lista i najwyzej cztery`() {
        val body = zgloszenieKolektora(
            RodzajZgloszenia.POMYSL, "x", "HOME", null, listOf("a", "b", "c", "d", "e"),
        )
        assertEquals(listOf("a", "b", "c", "d"), body.zdjecia)
        assertNull(body.wersja)
        val json = WertisJson.encodeToString(ZgloszenieBody.serializer(), body)
        assertTrue(json, json.contains("\"zdjecia\":[\"a\",\"b\",\"c\",\"d\"]"))
        assertFalse("brak wersji nie jedzie jako null", json.contains("wersja"))
    }

    @Test fun `wersja przycieta do limitu kontraktu`() {
        val body = zgloszenieKolektora(RodzajZgloszenia.POMYSL, "x", "HOME", "9".repeat(60), emptyList())
        assertEquals(ZGLOSZENIE_MAX_WERSJA, body.wersja!!.length)
    }

    @Test fun `ekran nie niesie zapytania ani kotwicy`() {
        assertEquals("HOME", zgloszenieKolektora(RodzajZgloszenia.POMYSL, "x", "HOME?q=Kowalski", null, emptyList()).ekran)
        assertEquals("HOME", zgloszenieKolektora(RodzajZgloszenia.POMYSL, "x", "HOME#a", null, emptyList()).ekran)
    }

    @Test fun `ekran to sama nazwa z mapy nawigacji`() {
        for (s in Screen.entries) {
            val e = ekranZgloszenia(s)
            assertEquals(s.name, e)
            assertTrue(e.length <= 200)
            assertTrue(e.all { it.isLetterOrDigit() || it == '_' })
        }
    }

    @Test fun `blokada mowi czego brakuje po kolei`() {
        assertNotNull(blokadaZgloszenia(null, "opis", 0))
        assertNotNull(blokadaZgloszenia(RodzajZgloszenia.BLAD, "   ", 0))
        assertNotNull(blokadaZgloszenia(RodzajZgloszenia.BLAD, "x".repeat(ZGLOSZENIE_MAX_OPIS + 1), 0))
        assertNotNull(blokadaZgloszenia(RodzajZgloszenia.BLAD, "ok", ZGLOSZENIE_MAX_ZDJEC + 1))
        assertNull(blokadaZgloszenia(RodzajZgloszenia.BLAD, "ok", ZGLOSZENIE_MAX_ZDJEC))
        // limit liczy się po przycięciu, tak jak na serwerze
        assertNull(blokadaZgloszenia(RodzajZgloszenia.BLAD, "  " + "x".repeat(ZGLOSZENIE_MAX_OPIS) + "  ", 0))
    }

    @Test fun `szkic pusty tylko bez rodzaju opisu i zdjec`() {
        assertFalse(szkicNiePusty(null, "  ", 0))
        assertTrue(szkicNiePusty(RodzajZgloszenia.POMYSL, "", 0))
        assertTrue(szkicNiePusty(null, "a", 0))
        assertTrue(szkicNiePusty(null, "", 1))
    }

    @Test fun `bajty base64 licza sie jak po zdekodowaniu`() {
        val enc = Base64.getEncoder()
        for (n in listOf(0, 1, 2, 3, 4, 5, 1000, 1001, 1002)) {
            val b64 = enc.encodeToString(ByteArray(n))
            assertEquals("n=$n", n, bajtyBase64(b64))
            assertEquals("n=$n bez dopełnienia", n, bajtyBase64(b64.trimEnd('=')))
            assertEquals("n=$n z prefiksem", n, bajtyBase64("data:image/jpeg;base64,$b64"))
        }
    }

    @Test fun `limit zdjecia to 1024 kB po zdekodowaniu`() {
        val enc = Base64.getEncoder()
        assertTrue(zdjecieMiesciSie(enc.encodeToString(ByteArray(ZDJECIE_ZGLOSZENIA_MAX_BAJTOW))))
        assertFalse(zdjecieMiesciSie(enc.encodeToString(ByteArray(ZDJECIE_ZGLOSZENIA_MAX_BAJTOW + 1))))
    }

    @Test fun `pierwsza proba z kontraktu to 1600 px i jakosc 80`() {
        assertEquals(ProbaZdjecia(1600, 80), PROBY_ZDJECIA.first())
        assertTrue(PROBY_ZDJECIA.all { it.bok <= 1600 })
    }

    @Test fun `kodowanie konczy na pierwszej mieszczacej sie probie`() {
        val enc = Base64.getEncoder()
        val proby = mutableListOf<ProbaZdjecia>()
        val wynik = zakodujZdjecieZgloszenia { p ->
            proby += p
            val n = if (p.jakosc == 80) ZDJECIE_ZGLOSZENIA_MAX_BAJTOW + 10 else 300_000
            enc.encodeToString(ByteArray(n))
        }
        assertEquals(2, proby.size)
        assertEquals(300_000, bajtyBase64(wynik!!))
    }

    @Test fun `kodowanie bez sukcesu oddaje ostatnia probe a nieczytelny plik null`() {
        val enc = Base64.getEncoder()
        val za = enc.encodeToString(ByteArray(ZDJECIE_ZGLOSZENIA_MAX_BAJTOW + 1))
        assertEquals(za, zakodujZdjecieZgloszenia { za })
        assertNull(zakodujZdjecieZgloszenia { null })
    }

    @Test fun `skan dopisuje kod do opisu`() {
        assertEquals("590123", dopiszKod("", "590123"))
        assertEquals("Nie czyta 590123", dopiszKod("Nie czyta", " 590123 "))
        assertEquals("Nie czyta 590123", dopiszKod("Nie czyta ", "590123"))
        assertEquals("bez zmian", dopiszKod("bez zmian", "  "))
    }

    @Test fun `zdanie bledu bierze polskie zdanie serwera`() {
        assertEquals("Opis jest pusty.", zdanieBleduZgloszenia(400, "Opis jest pusty."))
        // 413 przychodzi od Fastify po angielsku
        assertFalse(zdanieBleduZgloszenia(413, "Payload Too Large").contains("Payload"))
        assertTrue(zdanieBleduZgloszenia(500, null).contains("500"))
    }

    @Test fun `odpowiedz serwera dekoduje sie z nadmiarowymi polami`() {
        val json = """
            {"zgloszenie":{"id":12,"rodzaj":"blad","opis":"x","ekran":"HOME","zrodlo":"kolektor",
             "wersja":"0.618.0","urzadzenie":"TC21-03","at":"2026-11-05T12:00:00.000Z","autor":"Jan",
             "status":"nowe","odpowiedz":null,"statusAt":null,"statusPrzez":null,"zdjecia":[{"id":7}]}}
        """.trimIndent()
        val r = WertisJson.decodeFromString(ZgloszenieResponse.serializer(), json)
        assertEquals(12L, r.zgloszenie?.id)
    }

    @Test fun `cialo dekoduje sie z powrotem bez strat`() {
        val body = zgloszenieKolektora(RodzajZgloszenia.PRZESZKADZA, "a", "KARTON", "1.0", listOf("QUJD"))
        assertEquals(body, WertisJson.decodeFromString(ZgloszenieBody.serializer(), WertisJson.encodeToString(ZgloszenieBody.serializer(), body)))
    }
}
