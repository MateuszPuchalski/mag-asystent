package pl.wertis.kolektor.core.scan

import org.junit.Assert.assertEquals
import org.junit.Test

class ClassifyTest {

    @Test fun `prefiks LOC rozstrzyga jednoznacznie`() {
        assertEquals(Scan("E08-03-01", ScanKind.LOC), classify("LOC:E08-03-01"))
    }

    @Test fun `prefiks LOC bez wielkosci liter, kod uppercase`() {
        assertEquals(Scan("E08-03-01", ScanKind.LOC), classify("loc:e08-03-01"))
    }

    @Test fun `EAN-8`() {
        assertEquals(Scan("12345678", ScanKind.EAN), classify("12345678"))
    }

    @Test fun `EAN-13`() {
        assertEquals(Scan("5901234123457", ScanKind.EAN), classify("5901234123457"))
    }

    @Test fun `EAN-12 i EAN-14`() {
        assertEquals(ScanKind.EAN, classify("123456789012").kind)
        assertEquals(ScanKind.EAN, classify("12345678901234").kind)
    }

    @Test fun `9 cyfr to nie EAN - tekst`() {
        assertEquals(Scan("123456789", ScanKind.TEXT), classify("123456789"))
    }

    @Test fun `11 cyfr to nie EAN - tekst`() {
        assertEquals(ScanKind.TEXT, classify("12345678901").kind)
    }

    @Test fun `litera bez spacji = lokalizacja, uppercase`() {
        assertEquals(Scan("E08-03-01", ScanKind.LOC), classify("e08-03-01"))
    }

    @Test fun `symbol towaru z literami tez klasyfikuje sie jako loc (fallthrough decyduje ekran)`() {
        // Tak samo działa web: litery bez spacji → loc; fallback serwera i tak
        // szuka po symbolu, jeśli ekran przepuści skan niżej.
        assertEquals(ScanKind.LOC, classify("ABC123").kind)
    }

    @Test fun `spacje = tekst`() {
        assertEquals(Scan("ab cd", ScanKind.TEXT), classify("ab cd"))
    }

    @Test fun `trim przed klasyfikacja`() {
        assertEquals(Scan("12345678", ScanKind.EAN), classify("  12345678  "))
    }

    @Test fun `wlasny prefiks lokalizacji`() {
        assertEquals(Scan("A1-2", ScanKind.LOC), classify("MAG:A1-2", locPrefix = "MAG:"))
    }

    @Test fun `pusty prefiks nie przechwytuje`() {
        assertEquals(Scan("E08-03-01", ScanKind.LOC), classify("E08-03-01", locPrefix = ""))
    }
}
