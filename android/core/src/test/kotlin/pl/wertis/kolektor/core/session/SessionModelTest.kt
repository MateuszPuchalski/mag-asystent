package pl.wertis.kolektor.core.session

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/* Po przejściu na login i hasło (0.20.0) nie ma tu już żadnej decyzji do
   podjęcia: kto siada do kolektora, ten się loguje. Zostaje sam STAN — i on
   też ma test, bo od niego zależy, czyim nazwiskiem podpisze się operacja.   */

class SessionModelTest {

    private val jan = SessionState.Aktywna(1, "Jan Kowalski", "magazynier")

    @Test fun `stan sesji wie, kto pracuje`() {
        assertEquals(1L, jan.userId)
        assertEquals("Jan Kowalski", jan.osoba)
        assertEquals(null, SessionState.Brak.userId)
        assertEquals(null, SessionState.Brak.osoba)
    }

    @Test fun `inicjaly biora dwa pierwsze czlony, nie caly opis`() {
        // awatar ma 30 dp — trzeci człon i tak by się nie zmieścił
        assertEquals("JK", userInitials("Jan Kowalski"))
        assertEquals("JK", userInitials("  jan   kowalski-nowak "))
        assertEquals("B", userInitials("Biuro"))
        assertEquals("?", userInitials("   "))
    }

    @Test fun `rola niesie swoja wartosc dla serwera`() {
        // `SessionState.role` zostaje surowym łańcuchem: właścicielem zbioru ról
        // jest serwer, a nieznana rola ma zalogować, nie wywrócić aplikacji
        assertEquals("magazynier", Rola.MAGAZYNIER.wire)
        assertEquals("biuro", Rola.BIURO.wire)
        assertEquals("admin", Rola.ADMIN.wire)
    }

    @Test fun `sesja biurowa to biuro ALBO admin, nigdy hala`() {
        // Ekrany pytały o to dwa razy przez `role == "biuro"`. Po dojściu
        // czwartej roli taki zapis odbierałby adminowi konta i ustawienia
        // globalne — i to bez żadnego objawu poza „u mnie tego nie ma".
        for (r in listOf("biuro", "admin")) {
            assertTrue(r, SessionState.Aktywna(1, "Ktos", r).biurowa)
        }
        for (r in listOf("magazynier", "brygadzista", "administrator", "")) {
            assertFalse(r, SessionState.Aktywna(1, "Ktos", r).biurowa)
        }
        assertFalse(SessionState.Brak.biurowa)
    }
}
