package pl.wertis.kolektor.core.setup

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import pl.wertis.kolektor.core.session.Rola

/* Zakładanie kont to jedyny moment, w którym pomyłka blokuje CAŁE wdrożenie:
   źle założona lista kont zamurowuje administrację i trzeba ruszać bazę.      */

class SetupModelTest {

    private val biuro = Konto("Biuro Zakupy", Rola.BIURO, "4821")
    private val magazynier = Konto("Jan Kowalski", Rola.MAGAZYNIER)

    @Test fun `magazynier nie potrzebuje PIN-u`() {
        assertNull(bladKonta(magazynier))
    }

    @Test fun `brygadzista i biuro bez PIN-u to konta wadliwe od urodzenia`() {
        // bez PIN-u nie wykonają ŻADNEJ operacji uprzywilejowanej, więc
        // przepuszczenie takiego wiersza kończy się kontem, które nic nie może
        assertEquals(BladKonta.PIN_WYMAGANY, bladKonta(Konto("Adam", Rola.BRYGADZISTA)))
        assertEquals(BladKonta.PIN_WYMAGANY, bladKonta(Konto("Biuro", Rola.BIURO)))
    }

    @Test fun `PIN musi byc cyframi i odpowiedniej dlugosci`() {
        assertEquals(BladKonta.PIN_NIE_SAME_CYFRY, bladKonta(Konto("Adam", Rola.BIURO, "48a1")))
        assertEquals(BladKonta.PIN_ZA_KROTKI, bladKonta(Konto("Adam", Rola.BIURO, "48")))
        assertNull(bladKonta(Konto("Adam", Rola.BIURO, "4821")))
    }

    @Test fun `magazynier moze miec PIN, ale musi byc poprawny`() {
        // PIN magazyniera dziś nic nie otwiera, ale zapisany bylejaki stanie się
        // problemem w dniu, w którym ktoś dostanie awans na brygadzistę
        assertNull(bladKonta(Konto("Jan", Rola.MAGAZYNIER, "1234")))
        assertEquals(BladKonta.PIN_ZA_KROTKI, bladKonta(Konto("Jan", Rola.MAGAZYNIER, "12")))
    }

    @Test fun `pusta nazwa to pierwszy blad, nie brak PIN-u`() {
        // człowiek ma zobaczyć problem, który faktycznie popełnił
        assertEquals(BladKonta.BRAK_NAZWY, bladKonta(Konto("   ", Rola.BIURO)))
    }

    /* ── Warunki wysyłki ─────────────────────────────────────────────────── */

    @Test fun `lista od zera BEZ biura jest bezuzyteczna, wiec nie przechodzi`() {
        // każdy wiersz z osobna jest poprawny, a mimo to nikt nie zalozy potem
        // kolejnego konta ani nie zresetuje PIN-u
        val bezBiura = listOf(magazynier, Konto("Adam", Rola.BRYGADZISTA, "7315"))
        assertTrue(bezBiura.all { bladKonta(it) == null })
        assertFalse(mozliwaWysylka(bezBiura, odZera = true))
        // przy dokładaniu do istniejącej instalacji biuro już jest — wolno
        assertTrue(mozliwaWysylka(bezBiura, odZera = false))
    }

    @Test fun `pusta lista nie jest gotowa do wyslania`() {
        assertFalse(mozliwaWysylka(emptyList(), odZera = true))
        assertFalse(mozliwaWysylka(emptyList(), odZera = false))
    }

    @Test fun `jeden zly wiersz blokuje cala liste`() {
        assertFalse(mozliwaWysylka(listOf(biuro, Konto("", Rola.MAGAZYNIER)), odZera = true))
    }

    /* ── Kolejność ───────────────────────────────────────────────────────── */

    @Test fun `biuro idzie PIERWSZE, niezaleznie od kolejnosci wpisywania`() {
        // serwer wpuszcza konto bez sesji tylko przy pustej bazie; gdyby poszedł
        // pierwszy magazynier, zajalby te furtke i reszta odbilaby sie od 401
        // z lista kont zalozona w polowie
        val wpisane = listOf(magazynier, Konto("Adam", Rola.BRYGADZISTA, "7315"), biuro)
        val kolejnosc = kolejnoscWysylki(wpisane, odZera = true)
        assertEquals(Rola.BIURO, kolejnosc.first().rola)
        assertEquals(wpisane.size, kolejnosc.size)
        assertEquals(wpisane.toSet(), kolejnosc.toSet())
    }

    @Test fun `przy dokladaniu kolejnosc zostaje bez zmian`() {
        // sesja biura już istnieje, więc nie ma czego sortować — a przestawianie
        // wierszy bez powodu myli człowieka, który je właśnie wpisał
        val wpisane = listOf(magazynier, biuro)
        assertEquals(wpisane, kolejnoscWysylki(wpisane, odZera = false))
    }

    @Test fun `rola niesie swoja wartosc dla serwera`() {
        assertEquals("magazynier", Rola.MAGAZYNIER.wire)
        assertEquals("brygadzista", Rola.BRYGADZISTA.wire)
        assertEquals("biuro", Rola.BIURO.wire)
        assertFalse(Rola.MAGAZYNIER.wymagaPinu)
        assertTrue(Rola.BIURO.wymagaPinu)
    }
}
