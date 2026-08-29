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

    @Test fun `podpis polek mowi dokad towar wraca`() {
        assertEquals("bez adresu w kartotece", podpisPolek(null, emptyList()))
        assertEquals("bez adresu w kartotece", podpisPolek("  ", emptyList()))
        assertEquals("A01-02-03", podpisPolek("A01-02-03", listOf("A01-02-03")))
        // adres pickingowy zostaje pełnym kodem — to on jest odpowiedzią na
        // „dokąd to wróci"; reszta półek schodzi do licznika
        assertEquals(
            "A01-02-03 · +1 półka",
            podpisPolek("A01-02-03", listOf("A01-02-03", "B04-01-02")),
        )
        assertEquals(
            "A01-02-03 · +2 półki",
            podpisPolek("A01-02-03", listOf("A01-02-03", "B04-01-02", "C09-09-09")),
        )
        /* Odmiana w obie strony: 5 i 12 idą na „półek", 22 wraca na „półki".
           Końcówka 2–4 nie wystarcza — nastolatki są wyjątkiem. */
        assertEquals("A · +5 półek", podpisPolek("A", listOf("A") + (1..5).map { "P$it" }))
        assertEquals("A · +12 półek", podpisPolek("A", listOf("A") + (1..12).map { "P$it" }))
        assertEquals("A · +22 półki", podpisPolek("A", listOf("A") + (1..22).map { "P$it" }))
        // pole puste, ale półki są — bierzemy pierwszą, zamiast udawać brak
        assertEquals("B04-01-02", podpisPolek(null, listOf("B04-01-02")))
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
