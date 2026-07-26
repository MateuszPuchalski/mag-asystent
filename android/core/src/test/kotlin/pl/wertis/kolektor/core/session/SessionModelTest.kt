package pl.wertis.kolektor.core.session

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/* Ten sam gest znaczy cztery różne rzeczy. Najdroższy błąd to ten czwarty:
   ciche przejęcie tożsamości podpisuje cudzą pracę nie tym nazwiskiem.       */

class SessionModelTest {

    private val jan = SessionState.Aktywna(1, "Jan Kowalski", "magazynier")
    private val janZablokowany = SessionState.Zablokowana(1, "Jan Kowalski", "magazynier")
    private val JAN = "PRC-0001-9"
    private val PIOTR = "PRC-0002-8"

    @Test fun `bez sesji skan badge'a loguje`() {
        assertEquals(BadgeAction.Zaloguj(JAN), naBadge(SessionState.Brak, JAN, null))
    }

    @Test fun `wlasny badge przy czynnej sesji NIC nie robi`() {
        // ludzie skanują badge odruchowo, gdy nie wiedzą, co zrobić — taki skan
        // nie ma prawa zresetować otwartej dostawy
        assertEquals(BadgeAction.Nic, naBadge(jan, JAN, JAN))
    }

    @Test fun `wlasny badge zdejmuje blokade`() {
        assertEquals(BadgeAction.Odblokuj(JAN), naBadge(janZablokowany, JAN, JAN))
    }

    @Test fun `cudzy badge PYTA, nigdy nie przelacza po cichu`() {
        // to jest cały powód istnienia tego modelu: pozycje odłożone przez Jana
        // nie mogą dostać nazwiska Piotra bez wiedzy kogokolwiek
        val a = naBadge(jan, PIOTR, JAN)
        assertTrue("cudzy badge musi prowadzić do pytania", a is BadgeAction.ZapytajOPrzejecie)
        assertEquals("Jan Kowalski", (a as BadgeAction.ZapytajOPrzejecie).od)
    }

    @Test fun `cudzy badge pyta takze przy sesji zablokowanej`() {
        // zablokowana sesja to nadal CZYJAŚ praca — blokada nie czyni jej niczyją
        assertTrue(naBadge(janZablokowany, PIOTR, JAN) is BadgeAction.ZapytajOPrzejecie)
    }

    @Test fun `rozstrzyga KOD, nie nazwisko`() {
        // dwaj Kowalscy w magazynie to nie jest przypadek hipotetyczny
        val drugiKowalski = SessionState.Aktywna(2, "Jan Kowalski", "magazynier")
        assertTrue(naBadge(drugiKowalski, JAN, PIOTR) is BadgeAction.ZapytajOPrzejecie)
    }

    @Test fun `spacje i wielkosc liter nie robia z wlasnego badge'a cudzego`() {
        // skaner potrafi dokleić CR/LF, a kod z ręki bywa pisany małymi literami
        assertEquals(BadgeAction.Nic, naBadge(jan, "  prc-0001-9 ", JAN))
        assertEquals(BadgeAction.Odblokuj(JAN), naBadge(janZablokowany, "prc-0001-9", JAN))
    }

    @Test fun `bez zapamietanego kodu decyduje serwer, a nie domysl klienta`() {
        // Kod własnego badge'a zapisujemy razem z tokenem, więc null to stan
        // zdegenerowany (wyczyszczone dane aplikacji). Klient wtedy nie zgaduje:
        // proponuje odblokowanie, a serwer — który JEDEN wie, czyja to sesja —
        // odmawia cudzemu badge'owi i aplikacja pyta o przejęcie.
        assertEquals(BadgeAction.Odblokuj(PIOTR), naBadge(janZablokowany, PIOTR, null))
        // przy czynnej sesji nie ma czego odblokowywać, więc skan jest bezskutkowy
        assertEquals(BadgeAction.Nic, naBadge(jan, PIOTR, null))
    }

    @Test fun `stan sesji wie, kto pracuje`() {
        assertEquals(1L, jan.userId)
        assertEquals("Jan Kowalski", janZablokowany.osoba)
        assertEquals(null, SessionState.Brak.userId)
        assertEquals(null, SessionState.Brak.osoba)
    }
}
