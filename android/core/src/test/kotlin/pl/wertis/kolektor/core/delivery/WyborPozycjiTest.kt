package pl.wertis.kolektor.core.delivery

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/* Wejście z karty towaru na dostawę. Cała trudność mieści się w scenariuszu
   S26: ten sam towar w dokumencie dwa razy.                                   */

class WyborPozycjiTest {

    private data class W(val id: Int, val tw: Long, val status: String)

    private fun wybierz(pozycje: List<W>, tw: Long) =
        wybierzPozycjeTowaru(pozycje, tw, twIdPozycji = { it.tw }, status = { it.status })

    @Test fun `jeden wiersz towaru — otwiera sie on`() {
        val lista = listOf(W(1, 100, StatusLinii.TODO), W(2, 200, StatusLinii.TODO))
        assertEquals(1, wybierz(lista, 100)?.id)
    }

    @Test fun `DWA WIERSZE TEGO SAMEGO TOWARU — otwiera sie ten z robota`() {
        // Sedno S26. Pierwszy z brzegu jest odłożony, więc kliknięcie
        // „W dostawie …" trafiałoby w pozycję, przy której nie ma nic do zrobienia
        val lista = listOf(W(1, 100, StatusLinii.DONE), W(2, 100, StatusLinii.TODO))
        assertEquals(2, wybierz(lista, 100)?.id)
    }

    @Test fun `czesciowo odlozony tez jest robota`() {
        val lista = listOf(W(1, 100, StatusLinii.DONE), W(2, 100, StatusLinii.PARTIAL))
        assertEquals(2, wybierz(lista, 100)?.id)
    }

    @Test fun `wiersz z wyjatkiem nie jest robota do rutyny`() {
        // Wyjątek czeka na decyzję (D8), a nie na skan lokalizacji — otwieramy
        // go dopiero, gdy nie ma nic innego
        val lista = listOf(W(1, 100, StatusLinii.PROBLEM), W(2, 100, StatusLinii.TODO))
        assertEquals(2, wybierz(lista, 100)?.id)
    }

    @Test fun `same zamkniete wiersze — otwieramy pierwszy`() {
        // Milczenie po kliknięciu byłoby gorsze: człowiek nie wie, czy trafił.
        // Do odłożonej pozycji wraca się po poprawkę ilości albo drugą półkę.
        val lista = listOf(W(1, 100, StatusLinii.DONE), W(2, 100, StatusLinii.PROBLEM))
        assertEquals(1, wybierz(lista, 100)?.id)
    }

    @Test fun `towaru nie ma w dokumencie`() {
        assertNull(wybierz(listOf(W(1, 100, StatusLinii.TODO)), 999))
    }

    @Test fun `pusta lista`() {
        assertNull(wybierz(emptyList(), 100))
    }
}
