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

    @Test fun `wszystkie pozycje rozlozone, ale dostawa OTWARTA - do zamkniecia`() {
        /* ZMIANA REGUŁY w 0.44.1, nie poprawka testu. Do notatek biura komplet
           pozycji znaczył ukończenie, bo dostawa zamykała się sama w tej samej
           chwili — równość była prawdziwa. Notatka bez odpowiedzi ją zerwała:
           pozycje zrobione, faktura otwarta. Zielony wiersz mówił wtedy
           „zrobione" o czymś, co czeka na człowieka. */
        assertEquals(StanDokumentu.DO_ZAMKNIECIA, stanDokumentu(dok("FZ 4", 10, 10, "open")))
    }

    @Test fun `zamkniecie reczne wygrywa z liczeniem pozycji`() {
        /* Dostawę da się zamknąć z pozycjami pominiętymi — wtedy `linesDone`
           nie dobija do `linesTotal`, a dokument i tak jest skończony. */
        assertEquals(StanDokumentu.UKONCZONY, stanDokumentu(dok("FZ 5", 10, 7, "done")))
    }

    @Test fun `do dokonczenia idzie na gore, ukonczone na dol`() {
        // cztery stany, cztery kubełki: zaczęte, jeden ruch od końca, nowe,
        // zamknięte. Kolejność odpowiada na „co dokończyć najpierw".
        val lista = listOf(
            dok("FZ nowa A"),
            dok("FZ ukonczona", 5, 5, "done"),
            dok("FZ do zamkniecia", 5, 5, "open"),
            dok("FZ w toku", 5, 2, "open"),
            dok("FZ nowa B"),
        )
        assertEquals(
            listOf("FZ w toku", "FZ do zamkniecia", "FZ nowa A", "FZ nowa B", "FZ ukonczona"),
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

    /* ── Komplet pozycji przy OTWARTEJ dostawie (0.44.1) ──────────────────── */

    @Test fun `wszystko zeskanowane, ale dostawa otwarta - DO ZAMKNIECIA`() {
        /* Zgłoszenie z magazynu: „wszystko zeskanowane, a faktura jest na
           zielono". Do notatek biura ten stan był przelotny — dostawa zamykała
           się sama w tej samej sekundzie. Nieodpowiedziana notatka trzyma ją
           otwartą, więc stan stał się TRWAŁY i nie wolno mu wyglądać jak
           ukończenie. */
        val d = DeliveryDocument(dokId = 1, status = "open", linesTotal = 5, linesDone = 5)
        assertEquals(StanDokumentu.DO_ZAMKNIECIA, stanDokumentu(d))
    }

    @Test fun `UKONCZONY to WYLACZNIE status done`() {
        val d = DeliveryDocument(dokId = 1, status = "done", linesTotal = 5, linesDone = 5)
        assertEquals(StanDokumentu.UKONCZONY, stanDokumentu(d))
    }

    @Test fun `zamknieta z pominietymi pozycjami zostaje UKONCZONA`() {
        // `zakonczDostawe` domyka dostawę z pozycjami pominiętymi — licznik
        // bywa wtedy niepełny, a status jest rozstrzygający
        val d = DeliveryDocument(dokId = 1, status = "done", linesTotal = 5, linesDone = 3)
        assertEquals(StanDokumentu.UKONCZONY, stanDokumentu(d))
    }

    @Test fun `DO ZAMKNIECIA stoi nad nietknietymi, pod w toku`() {
        // kolejność mówi „co dokończyć najpierw": zaczęte, potem jeden ruch
        // od końca, potem nowe, na końcu zamknięte
        val doZam = DeliveryDocument(dokId = 1, status = "open", linesTotal = 5, linesDone = 5)
        val wToku = DeliveryDocument(dokId = 2, status = "open", linesTotal = 5, linesDone = 2)
        val nowy = DeliveryDocument(dokId = 3)
        val done = DeliveryDocument(dokId = 4, status = "done", linesTotal = 5, linesDone = 5)
        assertEquals(
            listOf(2L, 1L, 3L, 4L),
            uporzadkujDokumenty(listOf(done, nowy, doZam, wToku)).map { it.dokId }
        )
    }
}