package pl.wertis.kolektor.core.scan

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/* Klasyfikator jest jedynym miejscem, w którym system decyduje, CZYM jest
   zeskanowany kod. Pomyłka tutaj nie kończy się komunikatem — kończy się
   zapisem widmowej lokalizacji o nazwie symbolu towaru. Stąd tabela: każdy
   realny kształt kodu z tego magazynu ma tu swój wiersz.                     */

class ClassifyTest {

    /** Reguła jak z serwera (`config.locPatterns`). */
    private val cfg = ScanConfig.of(listOf("^[A-Z]\\d{2}-\\d{2}-\\d{2}$", "^PAL-\\d{3}$"))

    @After fun po() = ScanRules.reset()

    private val tabela: List<Triple<String, ScanKind, String>> = listOf(
        // regały — jedyny kształt, który JEST lokalizacją
        Triple("A01-02-03", ScanKind.LOC, "regał, wzorzec podstawowy"),
        Triple("J14-05-02", ScanKind.LOC, "regał, ostatnia alejka"),
        Triple("a01-02-03", ScanKind.LOC, "małe litery — normalizowane"),
        Triple("  A01-02-03  ", ScanKind.LOC, "spacje z wedge'a obcinane"),
        Triple("PAL-042", ScanKind.LOC, "miejsce paletowe"),
        Triple("LOC:A01-02-03", ScanKind.LOC, "prefiks z QR rozstrzyga"),

        // symbole towarów — TO jest błąd, który ta zmiana naprawia
        Triple("w32-0203", ScanKind.TEXT, "symbol z literą i myślnikiem"),
        Triple("W32-0203", ScanKind.TEXT, "ten sam symbol wielkimi literami"),
        Triple("50-111", ScanKind.TEXT, "symbol bez litery"),
        Triple("W43-2002-1M", ScanKind.TEXT, "dwa myślniki, ale nie kształt regału"),
        Triple("ABC123", ScanKind.TEXT, "symbol bez myślnika"),

        // kody kreskowe
        Triple("5901234567890", ScanKind.EAN, "EAN-13"),
        Triple("12345678", ScanKind.EAN, "EAN-8"),
        Triple("123456789012", ScanKind.EAN, "EAN-12"),
        Triple("12345678901234", ScanKind.EAN, "EAN-14"),
        Triple("123456789", ScanKind.TEXT, "9 cyfr to nie EAN"),
        Triple("12345678901", ScanKind.TEXT, "11 cyfr to nie EAN"),

        // kształty bliskie regałowi, ale niepoprawne — muszą wypaść z LOC
        Triple("A1-2-3", ScanKind.TEXT, "za mało cyfr w segmentach"),
        Triple("A01-02-03X", ScanKind.TEXT, "ogon po wzorcu"),
        Triple("C07A-06-01", ScanKind.TEXT, "literówka z kartoteki (znany dług danych)"),
        Triple("ab cd", ScanKind.TEXT, "spacja"),
        Triple("", ScanKind.TEXT, "pusty skan"),
    )

    @Test fun `tabela realnych ksztaltow kodu`() {
        for ((kod, oczekiwany, po) in tabela) {
            assertEquals("$kod — $po", oczekiwany, classify(kod, cfg).kind)
        }
    }

    @Test fun `LOC jest kategoria ZAMKNIETA, nie domyslna`() {
        // istota poprawki: kod nieznanego kształtu NIE staje się lokalizacją
        for (dziwny in listOf("X", "TOWAR/2026", "@#!", "A01_02_03")) {
            assertEquals(dziwny, ScanKind.TEXT, classify(dziwny, cfg).kind)
        }
    }

    @Test fun `prefiks i wzorzec daja ten sam znormalizowany kod`() {
        assertEquals(Scan("A01-02-03", ScanKind.LOC), classify("LOC:a01-02-03", cfg))
        assertEquals(Scan("A01-02-03", ScanKind.LOC), classify("a01-02-03", cfg))
    }

    @Test fun `wlasny prefiks lokalizacji`() {
        val inny = ScanConfig.of(emptyList(), locPrefix = "MAG:")
        assertEquals(Scan("A1-2", ScanKind.LOC), classify("MAG:A1-2", inny))
    }

    @Test fun `bez reguly z serwera dziala tryb ostrozny`() {
        // Kolektor, który nigdy nie dostał odpowiedzi, NIE zgaduje wzorca:
        // lokalizacją jest wyłącznie to, co człowiek zadeklarował prefiksem.
        val ostrozny = ScanConfig.CAUTIOUS
        assertEquals(ScanKind.TEXT, classify("A01-02-03", ostrozny).kind)
        assertEquals(ScanKind.LOC, classify("LOC:A01-02-03", ostrozny).kind)
        assertEquals(ScanKind.EAN, classify("5901234567890", ostrozny).kind)
    }

    @Test fun `regula z serwera obowiazuje globalnie, takze zrodla sprzetowe`() {
        // źródła skanera klasyfikują poza Compose, więc biorą regułę z ScanRules
        assertEquals(ScanKind.TEXT, classify("A01-02-03").kind)
        ScanRules.apply(cfg)
        assertEquals(ScanKind.LOC, classify("A01-02-03").kind)
    }

    @Test fun `zly regex z serwera nie wywraca skanera`() {
        val zepsuty = ScanConfig.of(listOf("^[A-Z(\\d{2}", "^PAL-\\d{3}\$"))
        assertTrue(zepsuty.locPatterns.isNotEmpty()) // poprawny wzorzec przeżył
        assertEquals(ScanKind.LOC, classify("PAL-042", zepsuty).kind)
    }
}
