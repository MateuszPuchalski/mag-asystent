package pl.wertis.kolektor.core.karton

import org.junit.Assert.assertEquals
import org.junit.Test

/* Faza kartonu i kolejność zbierania. Obie reguły wyglądają na oczywiste,
   dopóki nie zapyta się, CZEMU zbieranie ma inny porządek niż rozkładanie. */

class KartonTest {

    @Test fun `faza bierze sie ze statusu, a nie z osobnego przelacznika`() {
        assertEquals(FazaKartonu.ZBIORKA, fazaKartonu("otwarty"))
        assertEquals(FazaKartonu.ROZKLADANIE, fazaKartonu("zamkniety"))
        assertEquals(FazaKartonu.ZROBIONE, fazaKartonu("rozlozony"))
        assertEquals(FazaKartonu.ANULOWANY, fazaKartonu("anulowany"))
        // status, którego nie znamy, prowadzi do rozkładania — a nie do zbiórki:
        // dokładanie do cudzego pudła jest gorszą pomyłką niż zbędny ekran
        assertEquals(FazaKartonu.ROZKLADANIE, fazaKartonu("cokolwiek"))
    }

    @Test fun `przy zbieraniu najnowsza pozycja stoi na gorze`() {
        val poz = listOf(11L, 4L, 27L, 9L)
        assertEquals(listOf(27L, 11L, 9L, 4L), kolejnoscZbierania(poz) { it })
    }

    @Test fun `podpis mowi o pracy, nie o rekordzie w bazie`() {
        assertEquals("w zbiórce · pusty", podpisKartonu("otwarty", 0, 0))
        assertEquals("w zbiórce · 4 poz.", podpisKartonu("otwarty", 4, 0))
        assertEquals("do rozłożenia · 2/5 poz.", podpisKartonu("zamkniety", 5, 2))
        assertEquals("rozłożony", podpisKartonu("rozlozony", 5, 5))
        /* Anulowany podaje LICZBĘ POZYCJI, nie postęp: „2/5" przy pudle,
           którego nikt już nie rozłoży, czytałoby się jak praca w toku. */
        assertEquals("anulowany · 5 poz.", podpisKartonu("anulowany", 5, 2))
    }
}
