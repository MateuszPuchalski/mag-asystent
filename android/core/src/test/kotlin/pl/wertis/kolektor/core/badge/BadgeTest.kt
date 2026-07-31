package pl.wertis.kolektor.core.badge

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import pl.wertis.kolektor.core.scan.ScanConfig
import pl.wertis.kolektor.core.scan.ScanKind
import pl.wertis.kolektor.core.scan.classify

/* Badge rozstrzyga, KTO wykonał operację. Błąd tutaj nie kończy się
   komunikatem — kończy się wpisem w audycie pod cudzym nazwiskiem.

   Kolektor odpowiada wyłącznie za rozpoznanie KSZTAŁTU: skan badge'a ma pójść
   ścieżką logowania, a nie do wyszukiwarki towarów. Cyfrę kontrolną liczy
   i weryfikuje serwer (`server/src/services/users.ts`, wektory w jego testach)
   — do 0.17.0 istniała tu druga implementacja, której nikt w aplikacji nie
   wołał, a która mogła się z tamtą rozjechać bez żadnego objawu.             */

class BadgeTest {

    @Test fun `kod o ksztalcie badge'a jest rozpoznawany`() {
        for (kod in listOf("PRC-0001-9", "PRC-0007-3", "PRC-9999-8")) {
            assertTrue(kod, looksLikeBadge(kod))
        }
        assertTrue("spacje i małe litery nie psują skanu", looksLikeBadge(" prc-0007-3 "))
    }

    @Test fun `co nie ma ksztaltu badge'a, nie udaje badge'a`() {
        for (zly in listOf("PRC-007-3", "PRC-00073", "ABC-0007-3", "A01-02-03", "5901234567890", "")) {
            assertFalse(zly, looksLikeBadge(zly))
        }
    }

    @Test fun `badge to kategoria ZAMKNIETA w klasyfikatorze`() {
        val cfg = ScanConfig.of(listOf("^[A-Z]\\d{2}-\\d{2}-\\d{2}$", "^PAL-\\d{3}$"))
        assertEquals(ScanKind.BADGE, classify("PRC-0007-3", cfg).kind)
        // kształt wygrywa nawet przy złej cyfrze — inaczej skan uszkodzonej
        // etykiety poleciałby do wyszukiwarki towarów i zniknął. Odmowę wystawia
        // serwer, po sprawdzeniu cyfry kontrolnej.
        assertEquals(ScanKind.BADGE, classify("PRC-0007-4", cfg).kind)
        assertEquals(ScanKind.LOC, classify("A01-02-03", cfg).kind)
        assertEquals(ScanKind.EAN, classify("5901234567890", cfg).kind)
        assertEquals(ScanKind.TEXT, classify("W32-0203", cfg).kind)
    }
}
