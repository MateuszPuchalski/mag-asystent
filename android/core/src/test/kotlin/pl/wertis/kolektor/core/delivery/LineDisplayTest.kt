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

    /* ── Kolejność pozycji ────────────────────────────────────────────────── */

    private data class Poz(val nazwa: String, val status: String, val lok: String?)

    private fun uporzadkuj(vararg p: Poz) =
        uporzadkujPozycje(p.toList(), { it.status }, { it.lok }).map { it.nazwa }

    @Test fun `odlozone schodza na dol listy`() {
        assertEquals(
            listOf("do zrobienia", "odlozone"),
            uporzadkuj(
                Poz("odlozone", StatusLinii.DONE, "A01-02-03"),
                Poz("do zrobienia", StatusLinii.TODO, "B02-01-01"),
            ),
        )
    }

    @Test fun `pominiete tez schodzi na dol`() {
        assertEquals(
            listOf("todo", "pominiete"),
            uporzadkuj(
                Poz("pominiete", StatusLinii.SKIPPED, "A01-02-03"),
                Poz("todo", StatusLinii.TODO, "B02-01-01"),
            ),
        )
    }

    @Test fun `pozycja z problemem ZOSTAJE na gorze`() {
        /* Wyjątek wypadł z rutyny i czeka na decyzję (D8). Zepchnięcie go pod
           zrobione byłoby schowaniem go — dokładnie tym, czego zabrania reguła
           „wyjątek nie zwija się nigdy". */
        assertEquals(
            listOf("problem", "todo", "odlozone"),
            uporzadkuj(
                Poz("problem", StatusLinii.PROBLEM, "A01-02-03"),
                Poz("odlozone", StatusLinii.DONE, "B02-01-01"),
                Poz("todo", StatusLinii.TODO, "C03-01-01"),
            ),
        )
    }

    @Test fun `bez lokalizacji nad odlozonymi, pod rutyna`() {
        assertEquals(
            listOf("z adresem", "bez adresu", "odlozone"),
            uporzadkuj(
                Poz("odlozone", StatusLinii.DONE, "A01-02-03"),
                Poz("bez adresu", StatusLinii.TODO, null),
                Poz("z adresem", StatusLinii.TODO, "B02-01-01"),
            ),
        )
    }

    @Test fun `czesciowo odlozona zostaje w rutynie`() {
        // partial to praca w toku — reszta partii nadal czeka na regał
        assertEquals(
            listOf("partial", "done"),
            uporzadkuj(
                Poz("done", StatusLinii.DONE, "A01-02-03"),
                Poz("partial", StatusLinii.PARTIAL, "B02-01-01"),
            ),
        )
    }

    @Test fun `wewnatrz kubelka zostaje kolejnosc alejkowa z serwera`() {
        assertEquals(
            listOf("A", "B", "C"),
            uporzadkuj(
                Poz("A", StatusLinii.TODO, "A01-01-01"),
                Poz("B", StatusLinii.TODO, "B01-01-01"),
                Poz("C", StatusLinii.TODO, "C01-01-01"),
            ),
        )
    }

    @Test fun `bez lokalizacji do decyzji nie liczy odlozonych`() {
        val lista = listOf(
            Poz("czeka", StatusLinii.TODO, null),
            Poz("juz odlozone", StatusLinii.DONE, null),
        )
        assertEquals(
            listOf("czeka"),
            czekaBezLokalizacji(lista, { it.status }, { it.lok }).map { it.nazwa },
        )
    }
}
