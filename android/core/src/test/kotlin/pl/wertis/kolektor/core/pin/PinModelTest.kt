package pl.wertis.kolektor.core.pin

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/* Wygasanie przypięcia to wymaganie BEZPIECZEŃSTWA DANYCH, nie wygody:
   kontekst, który przeżyje odejście pracownika od regału, zapisuje towar na
   półkę, przy której nikogo już nie ma — i nic nie wygląda na zepsute, dopóki
   ktoś nie pójdzie po ten towar. Dlatego zegar jest wstrzykiwany i dlatego ta
   maszyna stanów ma testy na czystym stanie, bez Compose.                    */

private const val TTL = 240_000L // 4 min
private const val AWAY = 60_000L

class PinModelTest {

    private var zegar = 1_000_000L
    private fun stan() = PinState(TTL, AWAY) { zegar }
    private fun uplyw(ms: Long) { zegar += ms }

    /* ── Parowanie w obie strony (§5) ────────────────────────────────────── */

    @Test fun `pusty stan - skan regalu przypina regal i otwiera go`() {
        val s = stan()
        assertEquals(PinAction.OpenLocation("A01-02-03"), s.onLoc("A01-02-03"))
        assertEquals(Pin.Loc("A01-02-03", zegar), s.pin)
    }

    @Test fun `pusty stan - skan towaru przypina towar i otwiera karte`() {
        val s = stan()
        assertEquals(PinAction.OpenProduct(7), s.onProduct(7, "W32-0203"))
        assertEquals(Pin.Tow(7, "W32-0203", zegar), s.pin)
    }

    @Test fun `przy regale - skan towaru zapisuje, REGAL zostaje przypiety`() {
        // sedno zmiany: człowiek stoi w tym samym miejscu i odłoży tu jeszcze kilka
        val s = stan()
        s.onLoc("A01-02-03")
        assertEquals(PinAction.Assign(7, "W32-0203", "A01-02-03"), s.onProduct(7, "W32-0203"))
        assertEquals("A01-02-03", (s.pin as Pin.Loc).code)
    }

    @Test fun `z towarem w rece - skan polki zapisuje, TOWAR zostaje przypiety`() {
        val s = stan()
        s.onProduct(7, "W32-0203")
        assertEquals(PinAction.Assign(7, "W32-0203", "A01-02-03"), s.onLoc("A01-02-03"))
        assertEquals(7L, (s.pin as Pin.Tow).twId)
    }

    @Test fun `osiem indeksow na jeden regal to dziewiec skanow`() {
        // liczba z planu §5: dziś 16 skanów + nawigacja, po zmianie 9 skanów
        val s = stan()
        var zapisy = 0
        s.onLoc("A01-02-03") // skan 1
        for (tw in 1L..8L) { // skany 2–9
            if (s.onProduct(tw, "S$tw") is PinAction.Assign) zapisy++
            uplyw(5_000)
        }
        assertEquals(8, zapisy)
        assertEquals("A01-02-03", (s.pin as Pin.Loc).code)
    }

    @Test fun `ten sam slot dwa razy - przepiecie, nie zapis`() {
        val s = stan()
        s.onLoc("A01-02-03")
        assertEquals(PinAction.OpenLocation("B02-02-02"), s.onLoc("B02-02-02"))
        assertEquals("B02-02-02", (s.pin as Pin.Loc).code)

        s.clear(PinGone.MANUAL)
        s.onProduct(1, "A")
        assertEquals(PinAction.OpenProduct(2), s.onProduct(2, "B"))
        assertEquals(2L, (s.pin as Pin.Tow).twId)
    }

    /* ── Wygasanie (§6) ──────────────────────────────────────────────────── */

    @Test fun `po TTL nastepny skan NIE wpada w stary kontekst`() {
        // test akceptacyjny z hali: przypnij regał, odejdź, wróć po 6 minutach
        val s = stan()
        s.onLoc("A01-02-03")
        uplyw(TTL + 1)
        val akcja = s.onProduct(7, "W32-0203")
        assertEquals("otwiera kartę, NIE zapisuje na porzucony regał",
            PinAction.OpenProduct(7), akcja)
    }

    @Test fun `wygasniecie jest zglaszane, nie ciche`() {
        val s = stan()
        s.onLoc("A01-02-03")
        uplyw(TTL + 5_000)
        val e = s.expireIfStale()
        assertNotNull(e)
        assertEquals(PinGone.TTL, e!!.reason)
        assertEquals("A01-02-03", (e.pin as Pin.Loc).code)
        assertTrue("czas trzymania trafia do audytu", e.heldMs >= TTL)
        assertNull(s.pin)
    }

    @Test fun `kazdy skan odswieza TTL`() {
        val s = stan()
        s.onLoc("A01-02-03")
        repeat(10) {
            uplyw(TTL - 1_000)
            assertNull("skan przed upływem TTL nie gasi kontekstu", s.expireIfStale())
            s.onProduct(1, "S")
        }
        assertNotNull(s.pin)
    }

    @Test fun `odejscie od ekranu gasi mocniej niz sam czas`() {
        val s = stan()
        s.onLoc("A01-02-03")
        uplyw(10_000) // TTL jeszcze daleko
        val e = s.onResume(awayFor = AWAY + 1)
        assertEquals(PinGone.AWAY, e?.reason)
        assertNull(s.pin)
    }

    @Test fun `krotkie zerkniecie na inna aplikacje nie gasi`() {
        val s = stan()
        s.onLoc("A01-02-03")
        uplyw(10_000)
        assertNull(s.onResume(awayFor = AWAY - 1))
        assertNotNull(s.pin)
    }

    @Test fun `powrot po dlugim czasie gasi po TTL, nawet gdy nieobecnosc byla krotka`() {
        val s = stan()
        s.onLoc("A01-02-03")
        uplyw(TTL + 1)
        assertEquals(PinGone.TTL, s.onResume(awayFor = 1_000)?.reason)
    }

    @Test fun `zmiana uzytkownika czysci bezwarunkowo`() {
        val s = stan()
        s.onLoc("A01-02-03")
        val e = s.clear(PinGone.USER)
        assertEquals(PinGone.USER, e?.reason)
        assertNull(s.pin)
        assertNull("nie ma czego czyścić drugi raz", s.clear(PinGone.USER))
    }

    @Test fun `pozostaly czas maleje i nie schodzi ponizej zera`() {
        val s = stan()
        assertEquals(0L, s.remainingMs())
        s.onLoc("A01-02-03")
        assertEquals(TTL, s.remainingMs())
        uplyw(TTL / 2)
        assertEquals(TTL / 2, s.remainingMs())
        uplyw(TTL * 10)
        assertEquals(0L, s.remainingMs())
    }
}
