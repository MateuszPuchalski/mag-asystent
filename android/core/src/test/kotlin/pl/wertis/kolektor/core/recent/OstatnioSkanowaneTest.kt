package pl.wertis.kolektor.core.recent

import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Test

/* ── „Ostatnio skanowane" ────────────────────────────────────────────────────
   Sedno tych testów: lista ma mówić o towarze to samo, co karta tego towaru.
   Rozjazd nie wygląda na błąd — wygląda na dwie sprzeczne prawdy o tej samej
   półce, a magazynier nie ma jak rozstrzygnąć, która obowiązuje.            */

class OstatnioSkanowaneTest {

    private fun wpis(id: Long, loc: String = "A01-01-01", name: String = "Kosa spalinowa") =
        RecentEntry(id, "W32-020$id", loc, name)

    /* ── dopisywanie ──────────────────────────────────────────────────────── */

    @Test fun `nowe otwarcie idzie na wierzch`() {
        val lista = dopisz(listOf(wpis(1)), wpis(2))
        assertEquals(listOf(2L, 1L), lista.map { it.id })
    }

    @Test fun `ten sam towar nie dubluje sie, tylko wraca na gore`() {
        val lista = dopisz(listOf(wpis(1), wpis(2), wpis(3)), wpis(3, loc = "B02-02-02"))
        assertEquals(listOf(3L, 1L, 2L), lista.map { it.id })
        assertEquals("wraca ze świeżym adresem, nie ze starym", "B02-02-02", lista.first().loc)
    }

    @Test fun `lista nie rosnie ponad cztery pozycje`() {
        var lista = emptyList<RecentEntry>()
        (1L..6L).forEach { lista = dopisz(lista, wpis(it)) }
        assertEquals(OSTATNIE_SZTUK, lista.size)
        assertEquals("wypada najstarszy", listOf(6L, 5L, 4L, 3L), lista.map { it.id })
    }

    /* ── odświeżanie po zmianie adresu ────────────────────────────────────── */

    @Test fun `zmiana adresu na karcie dochodzi do listy`() {
        // to jest cała ta usterka: relokacja z karty, powrót na ekran główny
        // i adres SPRZED zmiany pod „Ostatnio skanowane"
        val lista = odswiez(listOf(wpis(1), wpis(2)), 2, "C03-03-03", "Kosa spalinowa")
        assertEquals("C03-03-03", lista.first { it.id == 2L }.loc)
    }

    @Test fun `odswiezenie NIE przestawia kolejnosci`() {
        // kolejność mówi „co trzymałem w ręku"; przeskok pod kciukiem trafia
        // w sąsiednią pozycję, czyli w cudzy towar
        val lista = odswiez(listOf(wpis(1), wpis(2), wpis(3)), 3, "C03-03-03", "Kosa spalinowa")
        assertEquals(listOf(1L, 2L, 3L), lista.map { it.id })
    }

    @Test fun `towar spoza listy sie na nia nie wprasza`() {
        val przed = listOf(wpis(1))
        assertSame(przed, odswiez(przed, 9, "C03-03-03", "Cokolwiek"))
    }

    @Test fun `bez zmiany oddaje TE SAMA liste`() {
        // karta odpytuje serwer co 2 s — inaczej każde odpytanie pisałoby
        // do SharedPreferences dokładnie to samo
        val przed = listOf(wpis(1, loc = "A01-01-01"))
        assertSame(przed, odswiez(przed, 1, "A01-01-01", "Kosa spalinowa"))
    }

    @Test fun `pusta nazwa nie kasuje znanej`() {
        val lista = odswiez(listOf(wpis(1, name = "Kosa spalinowa")), 1, "C03-03-03", "")
        assertEquals("Kosa spalinowa", lista.first().name)
    }

    /* ── etykieta adresu ──────────────────────────────────────────────────── */

    @Test fun `towar bez adresu dostaje zdanie, nie pusty tekst`() {
        assertEquals(BRAK_ADRESU, etykietaAdresu(null))
        assertEquals(BRAK_ADRESU, etykietaAdresu(""))
        assertEquals(BRAK_ADRESU, etykietaAdresu("   "))
        assertEquals("A01-01-01", etykietaAdresu("A01-01-01"))
    }
}
