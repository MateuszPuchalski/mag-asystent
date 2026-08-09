package pl.wertis.kolektor.core.delivery

import org.junit.Assert.assertEquals
import org.junit.Test
import pl.wertis.kolektor.core.net.DeliveryDocument

class ListaDokumentowTest {

    private fun dok(
        nr: String,
        linesTotal: Int = 0,
        linesDone: Int = 0,
        status: String? = null,
    ) = DeliveryDocument(
        dokId = nr.hashCode().toLong(),
        nrPelny = nr,
        linesTotal = linesTotal,
        linesDone = linesDone,
        status = status,
    )

    @Test fun `nieotwarty dokument jest nowy`() {
        assertEquals(StanDokumentu.NOWY, stanDokumentu(dok("FZ 1")))
    }

    @Test fun `otwarty bez postepu jest w toku`() {
        // ktoś wszedł w dokument i odszedł — pozycje zostały zablokowane lockiem
        assertEquals(StanDokumentu.W_TOKU, stanDokumentu(dok("FZ 2", 10, 0, "open")))
    }

    @Test fun `czesciowo rozlozony jest w toku`() {
        assertEquals(StanDokumentu.W_TOKU, stanDokumentu(dok("FZ 3", 10, 4, "open")))
    }

    @Test fun `wszystkie pozycje rozlozone to ukonczony`() {
        assertEquals(StanDokumentu.UKONCZONY, stanDokumentu(dok("FZ 4", 10, 10, "open")))
    }

    @Test fun `zamkniecie reczne wygrywa z liczeniem pozycji`() {
        /* Dostawę da się zamknąć z pozycjami pominiętymi — wtedy `linesDone`
           nie dobija do `linesTotal`, a dokument i tak jest skończony. */
        assertEquals(StanDokumentu.UKONCZONY, stanDokumentu(dok("FZ 5", 10, 7, "done")))
    }

    @Test fun `do dokonczenia idzie na gore, ukonczone na dol`() {
        val lista = listOf(
            dok("FZ nowa A"),
            dok("FZ ukonczona", 5, 5, "open"),
            dok("FZ w toku", 5, 2, "open"),
            dok("FZ nowa B"),
        )
        assertEquals(
            listOf("FZ w toku", "FZ nowa A", "FZ nowa B", "FZ ukonczona"),
            uporzadkujDokumenty(lista).map { it.nrPelny },
        )
    }

    @Test fun `w obrebie kubelka zostaje kolejnosc z serwera`() {
        // serwer sortuje malejąco po dacie; kolektor nie ma prawa tego mieszać
        val lista = listOf(
            dok("FZ 30-08", 5, 1, "open"),
            dok("FZ 29-08", 5, 3, "open"),
            dok("FZ 28-08", 5, 2, "open"),
        )
        assertEquals(
            listOf("FZ 30-08", "FZ 29-08", "FZ 28-08"),
            uporzadkujDokumenty(lista).map { it.nrPelny },
        )
    }
}
