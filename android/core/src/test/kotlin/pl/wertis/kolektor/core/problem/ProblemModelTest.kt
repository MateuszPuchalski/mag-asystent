package pl.wertis.kolektor.core.problem

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class ProblemModelTest {

    /** Klucze muszą pokrywać się z PROBLEM_TYPES na serwerze — inaczej 400 w alejce. */
    @Test fun `klucze protokolu`() {
        assertEquals(
            listOf(
                "qty_short", "qty_over", "damaged", "wrong_item",
                "no_space", "unknown_barcode", "ean_conflict",
            ),
            ProblemType.entries.map { it.key },
        )
    }

    @Test fun `zdjecie obowiazkowe tam gdzie jest dowodem`() {
        val needPhoto = ProblemType.entries.filter { it.photoRequired }.map { it.key }.toSet()
        assertEquals(setOf("damaged", "wrong_item", "unknown_barcode"), needPhoto)
    }

    @Test fun `ilosc obowiazkowa przy roznicy ilosciowej`() {
        val needQty = ProblemType.entries.filter { it.qtyRequired }.map { it.key }.toSet()
        assertEquals(setOf("qty_short", "qty_over"), needQty)
    }

    @Test fun `blocker tlumaczy czego brakuje`() {
        // uszkodzenie bez zdjęcia to opinia, nie zgłoszenie
        assertNotNull(problemBlocker(ProblemType.DAMAGED, qty = null, hasPhoto = false))
        assertNull(problemBlocker(ProblemType.DAMAGED, qty = null, hasPhoto = true))

        // różnica ilościowa bez liczby jest bezużyteczna dla reklamacji
        assertNotNull(problemBlocker(ProblemType.QTY_SHORT, qty = null, hasPhoto = false))
        assertNull(problemBlocker(ProblemType.QTY_SHORT, qty = 0.0, hasPhoto = false))

        // ilość ujemna nie istnieje na palecie
        assertNotNull(problemBlocker(ProblemType.QTY_OVER, qty = -1.0, hasPhoto = false))

        // brak miejsca nie wymaga niczego — magazynier ma iść dalej
        assertNull(problemBlocker(ProblemType.NO_SPACE, qty = null, hasPhoto = false))
    }

    @Test fun `etykieta nieznanego klucza nie wybucha`() {
        assertEquals("Uszkodzony", ProblemType.labelOf("damaged"))
        assertEquals("cos_nowego", ProblemType.labelOf("cos_nowego"))
        assertNull(ProblemType.fromKey("cos_nowego"))
    }
}
