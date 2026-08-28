package pl.wertis.kolektor.core.text

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/* Filtr listy w otwartej dostawie. Każdy test odpowiada jednemu sposobowi,
   w jaki magazynier wpisuje to, co ma w ręce — i który do 0.117.0 kończył się
   pustą listą przy towarze leżącym w kartonie.                                */

class SzukanieTest {

    private data class Poz(val sym: String, val nazwa: String)

    private val karton = listOf(
        Poz("LS51-139", "Gaźnik kompletny do kosy"),
        Poz("SW-40", "Olej silnikowy SW-40"),
        Poz("LZ-6202", "Łożysko 6202 2RS"),
        Poz("KS-220", "Kosa spalinowa 220"),
    )

    private fun szukaj(q: String) =
        filtrujSzukaniem(karton, q, { it.sym }, { it.nazwa }).map { it.sym }

    @Test fun `bez ogonkow znajduje z ogonkami`() {
        // nikt nie przełącza klawiatury na ą, ć, ź stojąc przy palecie
        assertEquals(listOf("LS51-139"), szukaj("gaznik"))
        assertEquals(listOf("LZ-6202"), szukaj("lozysko"))
    }

    @Test fun `symbol bez myslnika to ten sam symbol`() {
        // etykieta bywa zdarta, a numer przepisywany z ręki
        assertEquals(listOf("LS51-139"), szukaj("ls51139"))
        assertEquals(listOf("LS51-139"), szukaj("LS51 139"))
        assertEquals(listOf("LS51-139"), szukaj("ls51-139"))
    }

    @Test fun `kolejnosc slow nie ma znaczenia`() {
        assertEquals(listOf("KS-220"), szukaj("kosa spalinowa"))
        assertEquals(listOf("KS-220"), szukaj("spalinowa kosa"))
    }

    @Test fun `kazde slowo musi trafic, wiec drugie zawęża`() {
        assertEquals(listOf("LS51-139"), szukaj("gaznik kosy"))
        // „kosa" jest w dwóch pozycjach, „spalinowa" zostawia jedną
        assertEquals(listOf("KS-220"), szukaj("kosa spalinowa"))
        assertTrue(szukaj("gaznik lozysko").isEmpty())
    }

    @Test fun `token z cyfra trafia takze w nazwe bez oddzielaczy`() {
        // `sw40` ma znaleźć „SW-40 olej" — myślnika w środku nazwy nie da się
        // pominąć zwykłym `contains`
        assertEquals(listOf("SW-40"), szukaj("sw40"))
    }

    @Test fun `literowka wchodzi DOPIERO przy zerze wynikow`() {
        /* Furtka jest odpowiedzią na „nic nie znalazłem". Gdyby liczyła się
           razem z dopasowaniem dosłownym, „kosa" wciągałaby „kosy" z gaźnika
           i psuła wynik, który był dobry. */
        assertEquals(listOf("LS51-139"), szukaj("gaznk"))
        assertEquals(listOf("KS-220"), szukaj("spalinwa"))
        // dosłowne trafienie zostaje samo, mimo bliskich sąsiadów
        assertEquals(listOf("KS-220"), szukaj("spalinowa"))
    }

    @Test fun `krotkie slowo nie ma prawa do literowki`() {
        // jeden błąd na trzech znakach dopasowuje pół kartoteki
        assertTrue(szukaj("kot").isEmpty())
        assertEquals(null, progLiterowki(3))
        assertEquals(1, progLiterowki(5))
        assertEquals(2, progLiterowki(9))
    }

    @Test fun `puste zapytanie i same oddzielacze nie filtruja`() {
        /* Koniunkcja po pustym zbiorze jest prawdziwa, więc bez strażnika
           w `tokenySzukania` filtr przepuszczałby wszystko — i wyglądałoby to
           jak znalezienie czegoś, a nie jak brak zapytania. */
        assertEquals(karton.map { it.sym }, szukaj(""))
        assertEquals(karton.map { it.sym }, szukaj("   "))
        assertEquals(karton.map { it.sym }, szukaj("-- //"))
    }

    @Test fun `kolejnosc listy zostaje ta, ktora ustawilo rozkladanie`() {
        // filtr zawęża, nie sortuje — trasa alejkami należy do listy, nie tutaj.
        // „kos" trafia w „do kosy" (pozycja pierwsza) i w „Kosa" (ostatnia)
        assertEquals(listOf("LS51-139", "KS-220"), szukaj("kos"))
    }

    @Test fun `skladanie i zwijanie tekstu`() {
        assertEquals("gaznik kompletny", zloz("Gaźnik Kompletny"))
        assertEquals("zdzblo", zloz("ŹDŹBŁO"))
        assertEquals("ls51139", zwin("LS51-139"))
        assertEquals("ls51139", zwin("ls51 139"))
        assertEquals(listOf("kosa", "spalinowa"), tokenySzukania("Kosa-spalinowa"))
        assertTrue(tokenySzukania(" -- ").isEmpty())
    }

    @Test fun `odleglosc edycyjna liczy sie tylko do progu`() {
        assertEquals(0, odlegloscOgraniczona("kosa", "kosa", 2))
        assertEquals(1, odlegloscOgraniczona("kosa", "kosy", 2))
        // ponad progiem zwracamy `max + 1`, nie prawdziwą wartość
        assertEquals(3, odlegloscOgraniczona("kosa", "lozysko", 2))
        assertFalse(odlegloscOgraniczona("gaznik", "gaznk", 2) > 2)
    }
}
