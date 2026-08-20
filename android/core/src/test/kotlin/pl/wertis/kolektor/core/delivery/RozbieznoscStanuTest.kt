package pl.wertis.kolektor.core.delivery

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/* Wskaźnik rozbieżności ma jedną drogę do zepsucia: zapalić się przy zgodnych
   liczbach. Wtedy magazynier przestaje go czytać, a wtedy przestaje działać
   także wtedy, gdy coś naprawdę się nie zgadza. Stąd nacisk na przypadki,
   w których wynikiem MA BYĆ null. */

class RozbieznoscStanuTest {

    @Test fun `dostawa krajowa - nadwyzka to zapas sprzed tej dostawy`() {
        // przypadek ze zrzutu: dokument 200, na hali 219 z tą dostawą
        val r = rozbieznoscStanu(qtyDoc = 200.0, stanMag = 219.0, stanMgp = 0.0, stanZawieraDostawe = true)
        assertEquals(KierunekRozbieznosci.NADWYZKA, r?.kierunek)
        assertEquals(19.0, r?.roznica ?: 0.0, 1e-9)
    }

    @Test fun `dostawa krajowa - niedobor znaczy, ze towar zszedl przed rozlozeniem`() {
        val r = rozbieznoscStanu(qtyDoc = 200.0, stanMag = 180.0, stanMgp = 0.0, stanZawieraDostawe = true)
        assertEquals(KierunekRozbieznosci.NIEDOBOR, r?.kierunek)
        assertEquals(20.0, r?.roznica ?: 0.0, 1e-9)
    }

    @Test fun `zgodne liczby nie zapalaja niczego`() {
        assertNull(rozbieznoscStanu(200.0, 200.0, 0.0, true))
    }

    @Test fun `kontener porownuje sie z MGP, bo tam lezy partia`() {
        /* Gdyby liczyć z MAG, kontener zapalałby wskaźnik prawie zawsze:
           na hali leży wtedy wyłącznie zapas sprzed dostawy. */
        assertNull(rozbieznoscStanu(qtyDoc = 50.0, stanMag = 0.0, stanMgp = 50.0, stanZawieraDostawe = false))
        val r = rozbieznoscStanu(qtyDoc = 50.0, stanMag = 999.0, stanMgp = 30.0, stanZawieraDostawe = false)
        assertEquals(KierunekRozbieznosci.NIEDOBOR, r?.kierunek)
        assertEquals(20.0, r?.roznica ?: 0.0, 1e-9)
    }

    @Test fun `pozycja bez ilosci z dokumentu nie ma z czym sie porownac`() {
        // artykuł niezamówiony trafia na listę bez wiersza faktury
        assertNull(rozbieznoscStanu(qtyDoc = 0.0, stanMag = 12.0, stanMgp = 0.0, stanZawieraDostawe = true))
    }

    @Test fun `blad binarny na ulamkach nie zapala wskaznika`() {
        // metry i litry chodzą po kartotece; 0.1+0.2 nie jest równe 0.3
        val stan = 0.1 + 0.2
        assertNull(rozbieznoscStanu(qtyDoc = 0.3, stanMag = stan, stanMgp = 0.0, stanZawieraDostawe = true))
    }

    @Test fun `roznica jest zawsze dodatnia, znak niesie kierunek`() {
        val r = rozbieznoscStanu(10.0, 4.0, 0.0, true)
        assertEquals(6.0, r?.roznica ?: 0.0, 1e-9)
    }
}
