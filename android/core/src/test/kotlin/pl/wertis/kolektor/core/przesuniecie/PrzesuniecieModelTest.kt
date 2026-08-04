package pl.wertis.kolektor.core.przesuniecie

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PrzesuniecieModelTest {

    private val MAG = 1L
    private val MGP = 2L
    private val SERWIS = 90L

    private fun blocker(
        magFrom: Long? = MGP,
        magTo: Long? = MAG,
        qty: Double? = 2.0,
        dostepne: Double = 10.0,
        location: String? = "E08-03-01",
    ) = przesuniecieBlocker(magFrom, magTo, qty, dostepne, location, MAG)

    @Test fun `komplet danych przepuszcza`() {
        assertNull(blocker())
    }

    @Test fun `przesuniecie do tego samego magazynu to nie czynnosc`() {
        assertNotNull(blocker(magFrom = MAG, magTo = MAG))
    }

    @Test fun `ilosc zero i ujemna nie przechodzi`() {
        assertNotNull(blocker(qty = 0.0))
        assertNotNull(blocker(qty = -1.0))
        assertNotNull(blocker(qty = null))
    }

    /** Kolejka jest zarazem rezerwacją — `dostepne` to stan MINUS to, co już jedzie. */
    @Test fun `ilosc ponad dostepne mowi ile wolno`() {
        val b = blocker(qty = 11.0, dostepne = 10.0)
        assertNotNull(b)
        assertTrue("komunikat ma nieść liczbę: $b", b!!.contains("10"))
        assertFalse("bez zbędnego .0", b.contains("10.0"))
    }

    /**
     * Adres w kartotece opisuje regał na hali, bo `tw_Lokalizacja` to jedno
     * pole na towar, bez wymiaru magazynu.
     */
    @Test fun `na hale bez skanu polki nie przechodzi`() {
        assertNotNull(blocker(magTo = MAG, location = null))
        assertNotNull(blocker(magTo = MAG, location = "   "))
    }

    @Test fun `poza hale o polke sie nie pyta`() {
        assertNull(blocker(magFrom = MAG, magTo = SERWIS, location = null))
        assertFalse(pytamyOPolke(SERWIS, MAG))
        assertTrue(pytamyOPolke(MAG, MAG))
    }

    /** Kolejność komunikatów jest treścią: pierwszy jest tym, który człowiek zobaczy. */
    @Test fun `brak magazynu pyta o magazyn, nie o ilosc`() {
        assertEquals("Wybierz magazyn docelowy", blocker(magTo = null, qty = null))
    }
}
