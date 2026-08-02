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

    private val biuro = Konto("Biuro Zakupy", "biuro", "tajnehaslo", Rola.BIURO)
    private val magazynier = Konto("Jan Kowalski", "jkowalski", "tajnehaslo")

    @Test fun `poprawny wiersz przechodzi dla kazdej roli`() {
        assertNull(bladKonta(magazynier))
        assertNull(bladKonta(biuro))
    }

    @Test fun `konto bez hasla nie przechodzi, bo nie zalogowaloby sie nigdy`() {
        // serwer przyjmie takie konto tylko jako ślad z migracji historii —
        // wpisane ręcznie byłoby kontem, którego nikt nie użyje
        assertEquals(BladKonta.BRAK_HASLA, bladKonta(magazynier.copy(haslo = "")))
    }

    @Test fun `haslo krotsze niz minimum odpada tu, nie po podrozy przez siec`() {
        assertEquals(BladKonta.HASLO_ZA_KROTKIE, bladKonta(magazynier.copy(haslo = "krotkie")))
        assertEquals(HASLO_MIN, 8)
    }

    @Test fun `login o zlym ksztalcie odpada zanim poleci na serwer`() {
        // ten sam wzorzec zna serwer i to on rozstrzyga; kopia tutaj oszczędza
        // podróż przez sieć i komunikat, którego człowiek nie chciał zobaczyć
        assertEquals(BladKonta.BRAK_LOGINU, bladKonta(magazynier.copy(login = "  ")))
        for (zly in listOf("ab", "jan kowalski", "jan@wertis.pl", "żółw", "-start")) {
            assertEquals(zly, BladKonta.LOGIN_ZLY_KSZTALT, bladKonta(magazynier.copy(login = zly)))
        }
        for (dobry in listOf("abc", "anna.nowak", "brygada_1", "p-nowak")) {
            assertNull(dobry, bladKonta(magazynier.copy(login = dobry)))
        }
    }

    @Test fun `pusta nazwa to pierwszy blad, nie brak loginu`() {
        // człowiek ma zobaczyć problem, który faktycznie popełnił
        assertEquals(BladKonta.BRAK_NAZWY, bladKonta(Konto("   ", "", "", Rola.BIURO)))
    }

    /* ── Warunki wysyłki ─────────────────────────────────────────────────── */

    @Test fun `lista od zera BEZ biura jest bezuzyteczna, wiec nie przechodzi`() {
        // każdy wiersz z osobna jest poprawny, a mimo to nikt nie założy potem
        // kolejnego konta ani nie zmieni komuś hasła
        val bezBiura = listOf(magazynier, Konto("Adam", "abrygadzista", "tajnehaslo", Rola.BRYGADZISTA))
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
        assertFalse(mozliwaWysylka(listOf(biuro, Konto("", "", "", Rola.MAGAZYNIER)), odZera = true))
    }

    /* ── Kolejność ───────────────────────────────────────────────────────── */

    @Test fun `biuro idzie PIERWSZE, niezaleznie od kolejnosci wpisywania`() {
        // serwer wpuszcza konto bez sesji tylko przy pustej bazie; gdyby poszedł
        // pierwszy magazynier, zajalby te furtke i reszta odbilaby sie od 401
        // z lista kont zalozona w polowie
        val wpisane = listOf(magazynier, Konto("Adam", "abrygadzista", "tajnehaslo", Rola.BRYGADZISTA), biuro)
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
}
