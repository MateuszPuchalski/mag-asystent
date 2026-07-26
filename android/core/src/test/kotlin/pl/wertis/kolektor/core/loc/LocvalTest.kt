package pl.wertis.kolektor.core.loc

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import pl.wertis.kolektor.core.net.LocationsInfo

private const val REGAL = "^[A-Z]\\d{2}-\\d{2}-\\d{2}$"

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

    @Test fun `symbol towaru nie jest lokalizacja`() {
        // Zastępuje dawną regułę „musi zawierać literę", która przepuszczała
        // CAŁĄ rodzinę symboli tej firmy (W32-0203) i była przyczyną §1.
        val info = LocationsInfo(patterns = listOf(REGAL), strict = true)
        assertEquals("To kod towaru, nie etykieta regału", validateLoc("W32-0203", info))
        assertEquals("To kod towaru, nie etykieta regału", validateLoc("50-111", info))
    }

    @Test fun `bez reguly z serwera walidacja nie zgaduje`() {
        // Format sprawdzi serwer przy zapisie; tutaj nie ma na czym oprzeć odmowy.
        assertNull(validateLoc("E08-03-01"))
        assertNull(validateLoc("cokolwiek"))
    }

    @Test fun `strict - kod niepasujacy do formatu`() {
        val info = LocationsInfo(codes = emptyList(), patterns = listOf(REGAL), strict = true)
        assertNull(validateLoc("E08-03-01", info))
        assertNotNull(validateLoc("EXX", info))
    }

    @Test fun `starszy serwer wysyla format zamiast listy wzorcow`() {
        val stary = LocationsInfo(format = REGAL, strict = true)
        assertEquals(listOf(REGAL), stary.locPatterns())
        assertNull(validateLoc("E08-03-01", stary))
        assertNotNull(validateLoc("W32-0203", stary))
    }

    @Test fun `wylaczony strict przepuszcza wszystko poza regulami bazowymi`() {
        val luzny = LocationsInfo(patterns = listOf(REGAL), strict = false)
        assertNull(validateLoc("W32-0203", luzny))
        assertNotNull(validateLoc("E08 03", luzny)) // spacja nadal błędem
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
