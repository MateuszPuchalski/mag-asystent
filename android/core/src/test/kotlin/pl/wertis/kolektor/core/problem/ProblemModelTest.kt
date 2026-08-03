package pl.wertis.kolektor.core.problem

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class ProblemModelTest {

    /** Klucze muszą pokrywać się z PROBLEM_TYPES na serwerze — inaczej 400 w alejce. */
    @Test fun `klucze protokolu to piec kategorii formularza`() {
        assertEquals(
            listOf("wrong_item", "missing_item", "damaged", "qty_mismatch", "extra_item"),
            ProblemType.entries.map { it.key },
        )
    }

    @Test fun `zdjecie obowiazkowe tam gdzie jest dowodem`() {
        val needPhoto = ProblemType.entries.filter { it.photoRequired }.map { it.key }.toSet()
        assertEquals(setOf("damaged", "wrong_item"), needPhoto)
    }

    /** Formularz żąda ilości w każdej z pięciu kategorii — bez wyjątków. */
    @Test fun `kazda kategoria wymaga ilosci`() {
        ProblemType.entries.forEach { t ->
            assertNotNull(
                "${t.key} przepuszcza zgłoszenie bez ilości",
                problemBlocker(t, qty = null, hasPhoto = true, symObcy = "X", nrPrzesylki = "1", lineId = 1L),
            )
        }
    }

    /** Artykuł spoza dokumentu nie ma linii, z której dałoby się odczytać symbol. */
    @Test fun `artykul spoza dokumentu wymaga numeru katalogowego`() {
        val needSym = ProblemType.entries.filter { it.symObcyRequired }.map { it.key }.toSet()
        assertEquals(setOf("wrong_item", "extra_item"), needSym)

        assertNotNull(
            problemBlocker(ProblemType.EXTRA_ITEM, qty = 2.0, hasPhoto = false, symObcy = "  "),
        )
        assertNull(
            problemBlocker(ProblemType.EXTRA_ITEM, qty = 2.0, hasPhoto = false, symObcy = "K-1099"),
        )
    }

    @Test fun `blocker tlumaczy czego brakuje`() {
        // uszkodzenie bez zdjęcia to opinia, nie zgłoszenie
        assertNotNull(problemBlocker(ProblemType.DAMAGED, qty = 1.0, hasPhoto = false, nrPrzesylki = "1"))
        assertNull(problemBlocker(ProblemType.DAMAGED, qty = 1.0, hasPhoto = true, nrPrzesylki = "1"))

        // ilość ujemna nie istnieje na palecie
        assertNotNull(problemBlocker(ProblemType.MISSING_ITEM, qty = -1.0, hasPhoto = false))

        // zero jest legalne: „nie przyszło nic z zamówionych pięciu"
        assertNull(problemBlocker(ProblemType.MISSING_ITEM, qty = 0.0, hasPhoto = false))
    }

    /** Uszkodzenie bez numeru przesyłki nie ma czego wysłać przewoźnikowi. */
    @Test fun `uszkodzenie pyta o numer przesylki`() {
        assertNotNull(problemBlocker(ProblemType.DAMAGED, qty = 1.0, hasPhoto = true, nrPrzesylki = null))
        assertNull(problemBlocker(ProblemType.DAMAGED, qty = 1.0, hasPhoto = true, nrPrzesylki = "00159876543"))

        // pozostałe kategorie o przesyłkę nie pytają — to pole formularza
        // należy wyłącznie do uszkodzenia w transporcie
        assertNull(problemBlocker(ProblemType.MISSING_ITEM, qty = 1.0, hasPhoto = false, nrPrzesylki = null))
    }

    /** „Zła ilość" porównuje z dokumentem, więc bez pozycji nie ma z czym. */
    @Test fun `zla ilosc dotyczy pozycji z dokumentu`() {
        assertNotNull(problemBlocker(ProblemType.QTY_MISMATCH, qty = 3.0, hasPhoto = false, lineId = null))
        assertNull(problemBlocker(ProblemType.QTY_MISMATCH, qty = 3.0, hasPhoto = false, lineId = 7L))
    }

    @Test fun `etykieta nieznanego klucza nie wybucha`() {
        assertEquals("Uszkodzone w transporcie", ProblemType.labelOf("damaged"))
        assertEquals("cos_nowego", ProblemType.labelOf("cos_nowego"))
    }

    /**
     * Wyjątki sprzed 0.21.0 zostają w bazie na zawsze. Lista nierozwiązanych
     * pokazałaby bez tego surowy klucz `qty_short` — a to nie jest zdanie,
     * które da się przeczytać w alejce.
     */
    @Test fun `stary klucz ma etykiete choc nie da sie go juz zglosic`() {
        assertEquals("Za mało", ProblemType.labelOf("qty_short"))
        assertEquals("Kolizja EAN", ProblemType.labelOf("ean_conflict"))
        assertEquals(emptyList<String>(), ProblemType.entries.map { it.key }.filter { it == "qty_short" })
    }
}
