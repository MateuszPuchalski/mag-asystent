package pl.wertis.kolektor.core.update

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AktualizacjaTest {

    @Test fun `kod wersji zgadza sie ze wzorem z Gradle`() {
        assertEquals(4700, kodWersji("0.47.0"))
        assertEquals(4800, kodWersji("0.48.0"))
        assertEquals(10203, kodWersji("1.2.3"))
        assertEquals(0, kodWersji("0.0.0"))
    }

    @Test fun `sufiks wydania nie zmienia kodu`() {
        assertEquals(4800, kodWersji("0.48.0-rc1"))
    }

    @Test fun `smieci nie zamieniaja sie w zero`() {
        // `0.4x.0` czytane po gradle'owemu dałoby 400, czyli propozycję
        // instalacji wersji starszej od zainstalowanej
        assertNull(kodWersji("0.4x.0"))
        assertNull(kodWersji("brak"))
        assertNull(kodWersji(""))
        assertNull(kodWersji("   "))
        assertNull(kodWersji(null))
    }

    @Test fun `dwa czlony to za malo`() {
        assertNull(kodWersji("0.48"))
        assertNull(kodWersji("1"))
    }

    @Test fun `czlon powyzej 99 jest odrzucany, bo koliduje z sasiednia wersja`() {
        // 0.47.100 i 0.48.0 dają ten sam kod — kolizja czytałaby się jako
        // „ta sama wersja", więc aktualizacja znikałaby po cichu
        assertEquals(kodWersji("0.48.0"), 4800)
        assertNull(kodWersji("0.47.100"))
        assertNull(kodWersji("0.100.0"))
    }

    @Test fun `nowsza wersja na serwerze wchodzi`() {
        assertTrue(wartoAktualizowac("0.47.0", "0.48.0"))
        assertTrue(wartoAktualizowac("0.9.0", "0.10.0"))
    }

    @Test fun `rowna wersja nie jest aktualizacja`() {
        assertFalse(wartoAktualizowac("0.48.0", "0.48.0"))
    }

    @Test fun `starsza wersja na serwerze NIE jest proponowana`() {
        // downgrade kosztuje pełne odinstalowanie razem z buforem offline
        assertFalse(wartoAktualizowac("0.48.0", "0.47.0"))
        assertFalse(wartoAktualizowac("0.10.0", "0.9.0"))
    }

    @Test fun `nieczytelna wersja po ktorejkolwiek stronie znaczy nie`() {
        assertFalse(wartoAktualizowac("0.47.0", "brak"))
        assertFalse(wartoAktualizowac("brak", "0.48.0"))
        assertFalse(wartoAktualizowac(null, null))
        assertFalse(wartoAktualizowac("0.47.0", null))
    }

    @Test fun `bez sumy albo bez rozmiaru nie ma czego pobierac`() {
        assertTrue(mozliwaDoPobrania(1, "abc"))
        assertFalse(mozliwaDoPobrania(0, "abc"))
        assertFalse(mozliwaDoPobrania(-1, "abc"))
        assertFalse(mozliwaDoPobrania(10, ""))
        assertFalse(mozliwaDoPobrania(10, "   "))
        assertFalse(mozliwaDoPobrania(10, null))
    }

    @Test fun `suma porownuje sie bez wzgledu na wielkosc liter`() {
        assertTrue(zgodnaSuma("ABC123", "abc123"))
        assertTrue(zgodnaSuma(" abc ", "abc"))
    }

    @Test fun `pusta suma nigdy nie jest zgodna`() {
        assertFalse(zgodnaSuma("", ""))
        assertFalse(zgodnaSuma(null, null))
        assertFalse(zgodnaSuma("abc", "abcd"))
    }

    @Test fun `rozmiar pokazujemy w megabajtach`() {
        assertEquals("17 MB", rozmiarMb(18_234_112))
        assertEquals("1 MB", rozmiarMb(1_048_576))
        assertEquals("0 MB", rozmiarMb(1_000))
    }
}
