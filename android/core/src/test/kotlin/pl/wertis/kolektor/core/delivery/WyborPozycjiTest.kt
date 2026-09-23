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

    /* ── Rozpoznanie skanu bez sieci ──────────────────────────────────────── */

    private data class P(val id: Int, val tw: Long, val sym: String, val kody: List<String>, val status: String)

    private fun poKodzie(pozycje: List<P>, kod: String) =
        pozycjaPoKodzie(pozycje, kod, { it.tw }, { it.sym }, { it.kody }, { it.status })

    @Test fun `bez sieci skan EAN otwiera pozycje z listy`() {
        val lista = listOf(
            P(1, 100, "KOSA-1", listOf("5900000000011"), StatusLinii.TODO),
            P(2, 200, "GRABIE", listOf("5900000000028"), StatusLinii.TODO),
        )
        assertEquals(2, poKodzie(lista, "5900000000028")?.id)
    }

    @Test fun `symbol pasuje bez wielkosci liter`() {
        val lista = listOf(P(1, 100, "KOSA-1", emptyList(), StatusLinii.TODO))
        assertEquals(1, poKodzie(lista, "kosa-1")?.id)
    }

    @Test fun `kod dwoch roznych towarow nie zgaduje — kolizje rozstrzyga czlowiek`() {
        // D7: przy kolizji EAN operacja stoi, a bez sieci nie ma listy kandydatów
        val lista = listOf(
            P(1, 100, "KOSA-1", listOf("5900000000011"), StatusLinii.TODO),
            P(2, 200, "KOSA-2", listOf("5900000000011"), StatusLinii.TODO),
        )
        assertNull(poKodzie(lista, "5900000000011"))
    }

    @Test fun `ten sam towar w dwoch wierszach — regula S26 tez bez sieci`() {
        val lista = listOf(
            P(1, 100, "KOSA-1", listOf("5900000000011"), StatusLinii.DONE),
            P(2, 100, "KOSA-1", listOf("5900000000011"), StatusLinii.TODO),
        )
        assertEquals(2, poKodzie(lista, "5900000000011")?.id)
    }

    @Test fun `nieznany kod to null, nie pierwsza pozycja`() {
        val lista = listOf(P(1, 100, "KOSA-1", listOf("5900000000011"), StatusLinii.TODO))
        assertNull(poKodzie(lista, "5909999999999"))
        assertNull(poKodzie(lista, "  "))
    }
}
