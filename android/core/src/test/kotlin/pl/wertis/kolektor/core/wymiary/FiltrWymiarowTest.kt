package pl.wertis.kolektor.core.wymiary

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import pl.wertis.kolektor.core.net.PozycjaBezWymiarow

class FiltrWymiarowTest {

    @Test fun `domyslnie obchod regalow bez filtrow`() {
        val z = FiltrWymiarow().zapytanie(0)
        assertEquals(ZapytanieWymiarow("lokalizacja", null, null, 0), z)
    }

    @Test fun `porzadki mapuja sie na wartosci serwera`() {
        assertEquals(
            listOf("lokalizacja", "sprzedaz", "stan", "najnowsze"),
            PorzadekWymiarow.entries.map { it.parametr },
        )
    }

    @Test fun `flagi jada jako 1 albo wcale`() {
        val z = FiltrWymiarow(PorzadekWymiarow.SPRZEDAZ, naStanie = true, sprzedane = true).zapytanie(50)
        assertEquals(ZapytanieWymiarow("sprzedaz", "1", "1", 50), z)
        val tylkoStan = FiltrWymiarow(naStanie = true).zapytanie(0)
        assertEquals("1", tylkoStan.naStanie)
        assertNull(tylkoStan.sprzedane)
    }

    @Test fun `zmiana wyboru zaczyna liste od zera`() {
        val z = zmianaFiltra(FiltrWymiarow(), FiltrWymiarow(PorzadekWymiarow.STAN))
        assertEquals(ZapytanieWymiarow("stan", null, null, 0), z)
        val przelacznik = zmianaFiltra(FiltrWymiarow(), FiltrWymiarow(sprzedane = true))
        assertEquals(0, przelacznik!!.offset)
    }

    @Test fun `ten sam wybor nie przeladowuje listy`() {
        assertNull(zmianaFiltra(FiltrWymiarow(sprzedane = true), FiltrWymiarow(sprzedane = true)))
    }

    @Test fun `liczby w wierszu tylko gdy ustalaja porzadek albo filtr`() {
        assertFalse(FiltrWymiarow().pokazLiczby())
        assertFalse(FiltrWymiarow(PorzadekWymiarow.NAJNOWSZE).pokazLiczby())
        assertTrue(FiltrWymiarow(PorzadekWymiarow.SPRZEDAZ).pokazLiczby())
        assertTrue(FiltrWymiarow(PorzadekWymiarow.STAN).pokazLiczby())
        assertTrue(FiltrWymiarow(naStanie = true).pokazLiczby())
    }

    @Test fun `liczby jak w panelu`() {
        val p = PozycjaBezWymiarow(twId = 1, symbol = "A", stan = 3.0, sprzedaz = 12.5)
        assertEquals("sprzedano 12.5 · stan 3", liczbyWiersza(p))
    }

    @Test fun `pusta lista mowi dlaczego`() {
        assertEquals("Każdy towar ma wagę i wymiary.", pustaLista(FiltrWymiarow()))
        assertEquals("Każdy towar na stanie ma wagę i wymiary.", pustaLista(FiltrWymiarow(naStanie = true)))
        assertEquals("Każdy towar sprzedany w 30 dni ma wagę i wymiary.", pustaLista(FiltrWymiarow(sprzedane = true)))
        assertEquals(
            "Każdy towar na stanie i sprzedany w 30 dni ma wagę i wymiary.",
            pustaLista(FiltrWymiarow(naStanie = true, sprzedane = true)),
        )
        // porządek nie zmienia powodu pustej listy
        assertEquals("Każdy towar ma wagę i wymiary.", pustaLista(FiltrWymiarow(PorzadekWymiarow.STAN)))
    }
}
