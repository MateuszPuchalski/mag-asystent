package pl.wertis.kolektor.core.delivery

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/* Faktura sprawdzona w Subiekcie, ale nigdy nieotwarta na kolektorze, ma na tym
   ekranie zerowy postęp. Zanim ta reguła powstała, wyglądała przez to dokładnie
   jak nietknięta — i stała w kolejce do rozłożenia razem z nimi.              */

class StanFakturyTest {

    @Test fun `flaga biura zamyka dokument, choc postepu tu nie ma`() {
        assertTrue(dokumentZamkniety(linesTotal = 0, linesDone = 0, flagaKey = KluczFlagi.DONE))
    }

    @Test fun `sprawdzone z bledami tez jest sprawdzone`() {
        // rozbieżność ilościową ktoś już zobaczył i opisał — pracy z niej nie ma
        assertTrue(sprawdzona(KluczFlagi.DONE_WITH_ERRORS))
        assertTrue(dokumentZamkniety(0, 0, KluczFlagi.DONE_WITH_ERRORS))
    }

    @Test fun `praca w toku nie zamyka dokumentu`() {
        assertFalse(sprawdzona(KluczFlagi.IN_PROGRESS))
        assertFalse(sprawdzona(KluczFlagi.PAUSED))
        assertFalse(dokumentZamkniety(5, 2, KluczFlagi.IN_PROGRESS))
    }

    @Test fun `obca flaga firmy nie zamyka dokumentu`() {
        // o fladze spoza procesu wiemy tyle, że biuro coś nią oznaczyło;
        // serwer przysyła wtedy nazwę bez klucza stanu
        assertFalse(sprawdzona(null))
        assertFalse(dokumentZamkniety(0, 0, null))
    }

    @Test fun `wlasny postep domyka dokument bez zadnej flagi`() {
        // tryb edu i pilot: flag dokumentów nie ma dokąd wysyłać
        assertTrue(dokumentZamkniety(linesTotal = 3, linesDone = 3, flagaKey = null))
        assertFalse(dokumentZamkniety(linesTotal = 3, linesDone = 2, flagaKey = null))
    }

    @Test fun `pusty dokument nie jest zamkniety samym brakiem linii`() {
        // `linesTotal == 0` znaczy „nikt tu nie otwierał", a nie „nie ma pracy"
        assertFalse(dokumentZamkniety(linesTotal = 0, linesDone = 0, flagaKey = null))
    }
}
