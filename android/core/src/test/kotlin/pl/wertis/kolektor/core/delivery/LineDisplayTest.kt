package pl.wertis.kolektor.core.delivery

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/* Wiersz listy rozkładania ma jedną kolizję, która na ekranie wygląda jak
   zniknięcie treści spod palca — i której kompilator nie zobaczy.             */

class LineDisplayTest {

    @Test fun `do zrobienia to pelny wiersz`() {
        assertEquals(TrybWiersza.ZWYKLY, trybWiersza(StatusLinii.TODO, aktywna = false))
    }

    @Test fun `czesciowo odlozona wciaz wymaga pracy, wiec sie nie zwija`() {
        // `partial` znaczy „część poszła na półkę, reszta leży w kartonie" —
        // zwinięcie tego wiersza schowałoby robotę, która została
        assertEquals(TrybWiersza.ZWYKLY, trybWiersza(StatusLinii.PARTIAL, aktywna = false))
    }

    @Test fun `odlozona i pominieta zwijaja sie do paska`() {
        assertEquals(TrybWiersza.ZWINIETY, trybWiersza(StatusLinii.DONE, aktywna = false))
        assertEquals(TrybWiersza.ZWINIETY, trybWiersza(StatusLinii.SKIPPED, aktywna = false))
    }

    @Test fun `ROZWINIECIE WYGRYWA ZE ZWIJANIEM`() {
        // Sedno tej klasy. Magazynier wraca do odłożonej pozycji, żeby dołożyć
        // resztę partii albo zgłosić uszkodzenie po fakcie. Gdyby status
        // wygrywał, wiersz zwinąłby się dokładnie w chwili, w której człowiek
        // na niego patrzy — panel z lokalizacją zniknąłby spod palca.
        assertEquals(TrybWiersza.ROZWINIETY, trybWiersza(StatusLinii.DONE, aktywna = true))
        assertEquals(TrybWiersza.ROZWINIETY, trybWiersza(StatusLinii.SKIPPED, aktywna = true))
        assertEquals(TrybWiersza.ROZWINIETY, trybWiersza(StatusLinii.PROBLEM, aktywna = true))
    }

    @Test fun `problem nie zwija sie nigdy`() {
        // wyjątek wypadł z rutyny i czeka na decyzję — schowanie go w cienkim
        // pasku to dokładnie to, czego zasada D8 zabrania
        assertEquals(TrybWiersza.PROBLEM, trybWiersza(StatusLinii.PROBLEM, aktywna = false))
    }

    @Test fun `nieznany status traktujemy jako do zrobienia`() {
        // serwer może dołożyć status, którego ta wersja kolektora nie zna;
        // bezpieczniej pokazać pozycję jako do zrobienia niż ją schować
        assertEquals(TrybWiersza.ZWYKLY, trybWiersza("cos_nowego", aktywna = false))
    }

    /* ── Adres na wierszu ─────────────────────────────────────────────────── */

    @Test fun `pozycja bez adresu po odlozeniu pokazuje adres nadany`() {
        // TEN błąd był widoczny w hali: towar bez lokalizacji, odłożony
        // i opatrzony adresem, dalej pokazywał „BRAK", bo ekran czytał wyłącznie
        // snapshot z chwili otwarcia dostawy
        assertEquals("E08-03-01", adresWiersza(locExpected = null, locActual = "E08-03-01"))
    }

    @Test fun `nigdzie nieodlozona pozycja bez adresu zostaje bez adresu`() {
        assertNull(adresWiersza(locExpected = null, locActual = null))
    }

    @Test fun `faktyczny adres wygrywa z oczekiwanym`() {
        // rozjazd rozstrzygnięty na ZAMIEŃ: towar leży tam, gdzie go odłożono,
        // a nie tam, gdzie kartoteka spodziewała się go przy otwarciu dostawy
        assertEquals("B02-01-01", adresWiersza(locExpected = "A01-02-03", locActual = "B02-01-01"))
    }

    @Test fun `przed odlozeniem pokazujemy adres oczekiwany`() {
        assertEquals("A01-02-03", adresWiersza(locExpected = "A01-02-03", locActual = null))
    }
}
