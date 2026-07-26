package pl.wertis.kolektor.core.badge

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import pl.wertis.kolektor.core.scan.ScanConfig
import pl.wertis.kolektor.core.scan.ScanKind
import pl.wertis.kolektor.core.scan.classify

/* Badge rozstrzyga, KTO wykonał operację. Błąd tutaj nie kończy się
   komunikatem — kończy się wpisem w audycie pod cudzym nazwiskiem.           */

class BadgeTest {

    /* ── Wektory WSPÓLNE z serwerem ─────────────────────────────────────────
       Cyfra kontrolna ma dwie niezależne implementacje — Kotlin tutaj
       i TypeScript w `server/src/services/users.ts` — bo algorytmu nie da się
       wysłać z serwera jako wzorca, tak jak wysyłamy wzorce lokalizacji:
       badge trzeba rozpoznać zanim będzie sesja, więc offline. Duplikacja jest
       nieunikniona, rozjazd już nie: TA SAMA tabela jest zaasertowana po obu
       stronach (`server/src/services/users.test.ts`). Zmiana po jednej stronie
       zapala test po drugiej — i o to chodzi.

       Sam round-trip `parseBadge(badgeCode(n)) == n` tego NIE łapie: przechodzi
       też wtedy, gdy obie strony liczą cyfrę inaczej, byle każda spójnie ze
       sobą. Dlatego wektory są literałami.                                   */
    private val wektory = listOf(
        1 to "PRC-0001-9",
        7 to "PRC-0007-3",
        42 to "PRC-0042-6",
        999 to "PRC-0999-5",
        1234 to "PRC-1234-2",
        9999 to "PRC-9999-8",
    )

    @Test fun `kody badge zgadzaja sie z implementacja serwera`() {
        for ((numer, kod) in wektory) assertEquals(numer.toString(), kod, badgeCode(numer))
    }

    @Test fun `kod badge ma stala dlugosc i cyfre kontrolna`() {
        assertEquals("PRC-0007-3", badgeCode(7))
        assertEquals(10, badgeCode(9999).length)
    }

    @Test fun `odczyt wlasnego kodu wraca do numeru`() {
        for ((numer, kod) in wektory) assertEquals(kod, numer, parseBadge(kod))
    }

    @Test fun `przeklamana cyfra to NIE cudzy badge, tylko odmowa`() {
        // cały powód istnienia cyfry kontrolnej: starty znak na etykiecie nie
        // może zamienić Jana w Piotra, bo audyt wskazałby wtedy niewinnego
        assertEquals(7, parseBadge(badgeCode(7)))
        assertNull("zła cyfra kontrolna", parseBadge("PRC-0007-4"))
        assertNull("przekłamany numer", parseBadge("PRC-0008-3"))
    }

    @Test fun `przestawienie sasiednich cyfr jest wykrywane`() {
        // najczęstsza pomyłka przy przepisywaniu z ręki
        assertNull(parseBadge("PRC-0070-3"))
    }

    @Test fun `co nie jest badgem, nie udaje badge'a`() {
        for (zly in listOf("PRC-007-3", "PRC-00073", "ABC-0007-3", "A01-02-03", "5901234567890", "")) {
            assertNull(zly, parseBadge(zly))
        }
    }

    @Test fun `badge to kategoria ZAMKNIETA w klasyfikatorze`() {
        val cfg = ScanConfig.of(listOf("^[A-Z]\\d{2}-\\d{2}-\\d{2}$", "^PAL-\\d{3}$"))
        assertEquals(ScanKind.BADGE, classify("PRC-0007-3", cfg).kind)
        // kształt wygrywa nawet przy złej cyfrze — inaczej skan uszkodzonej
        // etykiety poleciałby do wyszukiwarki towarów i zniknął
        assertEquals(ScanKind.BADGE, classify("PRC-0007-4", cfg).kind)
        assertEquals(ScanKind.LOC, classify("A01-02-03", cfg).kind)
        assertEquals(ScanKind.EAN, classify("5901234567890", cfg).kind)
        assertEquals(ScanKind.TEXT, classify("W32-0203", cfg).kind)
    }

    @Test fun `kod nie niesie nazwiska`() {
        // badge się gubi i zostaje na kurtce — powiązanie kod → człowiek
        // istnieje wyłącznie w bazie
        assertTrue(badgeCode(7).all { it.isDigit() || it == '-' || it.isUpperCase() })
    }
}
