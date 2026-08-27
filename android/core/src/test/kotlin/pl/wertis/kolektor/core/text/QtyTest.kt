package pl.wertis.kolektor.core.text

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/* Ilość wpisana z klawiatury. Reguła wygląda na oczywistą, dopóki nie policzy
   się dróg, którymi ta sama liczba trafia do pola: przecinek z klawiatury
   numerycznej, kropka z fizycznej, spacja z odruchu rozdzielania tysięcy.     */

class QtyTest {

    @Test fun `zwykla liczba calkowita`() {
        assertEquals(120.0, iloscZWpisu("120")!!, 0.0)
    }

    @Test fun `przecinek i kropka znacza to samo`() {
        // klawiatura kolektora podaje raz jedno, raz drugie — magazynier
        // wpisuje to, co widzi na klawiszu
        assertEquals(2.5, iloscZWpisu("2,5")!!, 0.0)
        assertEquals(2.5, iloscZWpisu("2.5")!!, 0.0)
    }

    @Test fun `spacje i odstepy lecą`() {
        assertEquals(1200.0, iloscZWpisu(" 1 200 ")!!, 0.0)
    }

    @Test fun `zero przechodzi, bo korekta ilosci go potrzebuje`() {
        // „nie odłożyłem ani jednej" jest poprawną odpowiedzią przy poprawianiu
        // własnego liczenia; to wywołujący decyduje, czy zero ma tam sens
        assertEquals(0.0, iloscZWpisu("0")!!, 0.0)
    }

    @Test fun `to, co nie jest liczba, nie jest iloscia`() {
        assertNull(iloscZWpisu(""))
        assertNull(iloscZWpisu("   "))
        assertNull(iloscZWpisu("dwanaście"))
        assertNull(iloscZWpisu("12szt"))
        assertNull(iloscZWpisu("1.2.3"))
    }

    @Test fun `liczba ujemna to nie jest ilosc`() {
        assertNull(iloscZWpisu("-5"))
    }

    @Test fun `pomylka palca odpada zamiast zostac przycieta`() {
        /* Cicho obcięta liczba wygląda jak przyjęta, a pytanie brzmi „ile sztuk
           naprawdę przyjechało". Lepiej nie przyjąć wpisu niż przyjąć inny. */
        assertNull(iloscZWpisu("1000000"))
        assertNull(iloscZWpisu("500", maks = 100.0))
        assertEquals(100.0, iloscZWpisu("100", maks = 100.0)!!, 0.0)
    }
}
