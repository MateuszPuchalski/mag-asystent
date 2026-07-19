package pl.wertis.kolektor.core.loc

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import pl.wertis.kolektor.core.net.LocationsInfo

class LocvalTest {

    @Test fun `normalizacja - uppercase i prefiks LOC`() {
        assertEquals("E08-03-01", normalizeLoc(" loc:e08-03-01 "))
        assertEquals("E08-03-01", normalizeLoc("E08-03-01"))
    }

    @Test fun `pusty kod`() {
        assertEquals("Pusty kod lokalizacji", validateLoc(""))
    }

    @Test fun `spacja w kodzie`() {
        assertEquals("Kod lokalizacji nie może zawierać spacji", validateLoc("E08 03"))
    }

    @Test fun `EAN zamiast etykiety`() {
        assertNotNull(validateLoc("12345678"))
        assertTrue(validateLoc("5901234123457")!!.contains("EAN"))
    }

    @Test fun `kod bez litery`() {
        assertNotNull(validateLoc("080301"))
    }

    @Test fun `poprawny kod bez slownika`() {
        assertNull(validateLoc("E08-03-01"))
    }

    @Test fun `strict - kod niepasujacy do formatu`() {
        val info = LocationsInfo(codes = emptyList(), format = "^[A-Z]\\d{2}-\\d{2}-\\d{2}$", strict = true)
        assertNull(validateLoc("E08-03-01", info))
        assertNotNull(validateLoc("EXX", info))
    }

    @Test fun `zly regex formatu jest pomijany`() {
        val info = LocationsInfo(format = "[niedomknięty", strict = true)
        assertNull(validateLoc("E08-03-01", info))
    }

    @Test fun `slownik lokalizacji`() {
        val info = LocationsInfo(codes = listOf("E08-03-01"))
        assertTrue(isKnownLoc("E08-03-01", info))
        assertFalse(isKnownLoc("X99-99-99", info))
        assertFalse(isKnownLoc("E08-03-01", null))
    }
}
