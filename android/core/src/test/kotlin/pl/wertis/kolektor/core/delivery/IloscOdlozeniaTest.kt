package pl.wertis.kolektor.core.delivery

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/* Dwie usterki, które przeżyły dwadzieścia wydań w ciele composable'a:
   ścięty nadmiar i wyjątek przy pozycji zamkniętej. Oba są tu pierwszym
   i drugim testem, bo po to ta reguła wyszła z ekranu.                        */

class IloscOdlozeniaTest {

    @Test fun `NADMIAR PONAD FAKTURE IDZIE NA SERWER W CALOSCI`() {
        // Serce sprawy. Magazynier potwierdził 15 przy 10 na fakturze, bo tyle
        // przyjechało; ścięcie do 10 zapisywałoby stan magazynu niezgodny
        // z półką i odbierało biuru zgłoszenie wobec dostawcy.
        assertEquals(15.0, iloscDoOdlozenia(15.0)!!, 0.0)
        assertEquals(15.0, iloscNaKaflu(15.0, qtyDoc = 10.0, qtyDone = 0.0), 0.0)
    }

    @Test fun `poprawka na pozycji odlozonej w calosci nie wywala zapisu`() {
        // Reszta wynosi zero, a stare `coerceIn(1.0, 0.0)` rzucało tu
        // IllegalArgumentException — wracające do człowieka jako „Błąd zapisu",
        // nie do odróżnienia od zerwanego Wi-Fi.
        assertEquals(0.0, zostaloDoOdlozenia(qtyDoc = 10.0, qtyDone = 10.0), 0.0)
        assertEquals(3.0, iloscDoOdlozenia(3.0)!!, 0.0)
        assertEquals(3.0, iloscNaKaflu(3.0, qtyDoc = 10.0, qtyDone = 10.0), 0.0)
    }

    @Test fun `nietknieta ilosc zostaje nullem, bo reszte liczy serwer`() {
        // Podstawienie liczby zamrażałoby stan pozycji z chwili otwarcia panelu
        assertNull(iloscDoOdlozenia(null))
    }

    @Test fun `czesciowe odlozenie przechodzi bez zmian`() {
        assertEquals(3.0, iloscDoOdlozenia(3.0)!!, 0.0)
        assertEquals(3.0, iloscNaKaflu(3.0, qtyDoc = 10.0, qtyDone = 0.0), 0.0)
    }

    @Test fun `zero i liczby ujemne podnosza sie do jednej sztuki`() {
        // Zapis zerowej ilości serwer i tak odrzuca, a licznik nie ma jak
        // zejść niżej — to bezpiecznik, nie ścieżka
        assertEquals(1.0, iloscDoOdlozenia(0.0)!!, 0.0)
        assertEquals(1.0, iloscDoOdlozenia(-4.0)!!, 0.0)
    }

    @Test fun `reszta nigdy nie jest ujemna`() {
        // Po odłożeniu nadmiaru qtyDone przekracza qtyDoc; „zostało minus dwa"
        // nie jest ani zdaniem dla człowieka, ani liczbą do odejmowania
        assertEquals(0.0, zostaloDoOdlozenia(qtyDoc = 10.0, qtyDone = 15.0), 0.0)
        assertEquals(7.0, zostaloDoOdlozenia(qtyDoc = 10.0, qtyDone = 3.0), 0.0)
    }

    @Test fun `kafel nietknietej pozycji pokazuje cala reszte`() {
        assertEquals(7.0, iloscNaKaflu(null, qtyDoc = 10.0, qtyDone = 3.0), 0.0)
    }

    @Test fun `kafel pozycji zamknietej nie pokazuje zera`() {
        // Zero nie jest odpowiedzią na pytanie „ile idzie teraz"
        assertEquals(1.0, iloscNaKaflu(null, qtyDoc = 10.0, qtyDone = 10.0), 0.0)
    }

    @Test fun `echo bufora offline liczy to, co policzy serwer`() {
        // Widok z cache musi przeżyć brak sieci bez kłamstwa: 3 z 10 odłożone
        // to `partial`, nie zamknięta pozycja
        assertEquals(3.0, odlozonePoZapisie(3.0, qtyDoc = 10.0, qtyDone = 0.0), 0.0)
        assertEquals(10.0, odlozonePoZapisie(null, qtyDoc = 10.0, qtyDone = 0.0), 0.0)
        assertEquals(10.0, odlozonePoZapisie(7.0, qtyDoc = 10.0, qtyDone = 3.0), 0.0)
    }

    @Test fun `ECHO NIE SCINA NADMIARU DO DOKUMENTU`() {
        // Stary sufit `coerceAtMost(qtyDoc)` pokazywał „10 z 10" tam, gdzie na
        // półce leży 15 — kłamstwo dokładnie o tę sztukę, o którą chodzi
        assertEquals(15.0, odlozonePoZapisie(15.0, qtyDoc = 10.0, qtyDone = 0.0), 0.0)
        assertEquals(13.0, odlozonePoZapisie(5.0, qtyDoc = 10.0, qtyDone = 8.0), 0.0)
    }
}
