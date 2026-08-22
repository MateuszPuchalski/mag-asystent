package pl.wertis.kolektor.core.delivery

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/* Przycinanie logo do widocznej treści. Pomyłka o jeden piksel przy krawędzi
   obcina literę w logotypie i nikt tego nie zauważy poza dostawcą.           */

class LogoRamkaTest {

    /** Obraz `szer`×`wys` z nieprzezroczystym prostokątem w środku. */
    private fun obraz(
        szer: Int,
        wys: Int,
        x: Int,
        y: Int,
        w: Int,
        h: Int,
        alfa: Int = 255,
    ): IntArray {
        val piksele = IntArray(szer * wys)                 // 0 = w pełni przezroczysty
        for (wiersz in y until y + h) {
            for (kolumna in x until x + w) {
                piksele[wiersz * szer + kolumna] = (alfa shl 24) or 0x00FF7A00
            }
        }
        return piksele
    }

    @Test fun `szeroki logotyp w kwadracie oddaje sam pasek`() {
        /* Dokładnie to leży w bazie po panelu sprzed 0.87.0: pasek 128×40
           wyśrodkowany w kwadracie 128×128, czyli 88 pikseli powietrza. */
        val ramka = ramkaWidoczna(obraz(128, 128, x = 0, y = 44, w = 128, h = 40), 128, 128)
        assertEquals(RamkaLogo(0, 44, 128, 40), ramka)
    }

    @Test fun `ramka obejmuje skrajne piksele, nie zatrzymuje sie przed nimi`() {
        // błąd o jeden przy prawej albo dolnej krawędzi obcina literę
        val ramka = ramkaWidoczna(obraz(10, 10, x = 2, y = 3, w = 4, h = 5), 10, 10)
        assertEquals(RamkaLogo(2, 3, 4, 5), ramka)
    }

    @Test fun `obraz bez przezroczystosci zostaje caly`() {
        val ramka = ramkaWidoczna(obraz(8, 4, x = 0, y = 0, w = 8, h = 4), 8, 4)
        assertEquals(RamkaLogo(0, 0, 8, 4), ramka)
    }

    @Test fun `obraz calkiem pusty nie ma ramki`() {
        // `null` znaczy „nie ma czego przyciąć" — przycięcie do zera pikseli
        // zamieniłoby dziwne logo w brak logo, a to inna informacja
        assertNull(ramkaWidoczna(IntArray(64), 8, 8))
    }

    @Test fun `ledwie widoczny piksel nie rozciaga ramki`() {
        /* Antyaliasing zostawia wokół znaku obwódkę o alfie kilku jednostek.
           Gdyby liczyła się jak treść, przycięcie nie zdejmowałoby niczego. */
        val piksele = obraz(10, 10, x = 4, y = 4, w = 2, h = 2)
        piksele[0] = (4 shl 24) or 0x00FFFFFF
        assertEquals(RamkaLogo(4, 4, 2, 2), ramkaWidoczna(piksele, 10, 10))
    }

    @Test fun `puste wymiary i za krotka tablica nie wywracaja dekodowania`() {
        assertNull(ramkaWidoczna(IntArray(0), 0, 0))
        assertNull(ramkaWidoczna(IntArray(4), 10, 10))
    }

    /* ── Czy w ogóle przycinać ──────────────────────────────────────────── */

    @Test fun `kwadrat z powietrzem warto przyciac`() {
        assertTrue(wartoPrzyciac(RamkaLogo(0, 44, 128, 40), 128, 128))
    }

    @Test fun `logo juz przyciete zostawiamy w spokoju`() {
        // panel od 0.87.0 zapisuje obraz przycięty; kopiowanie bitmapy po to,
        // żeby zdjąć zero pikseli, jest czystym kosztem przy każdym wierszu
        assertFalse(wartoPrzyciac(RamkaLogo(0, 0, 256, 80), 256, 80))
    }

    @Test fun `krawedz o wlos nie jest powodem do ciecia`() {
        // 2% z 256 to pięć pikseli — mniej niż to jest szumem kompresji
        assertFalse(wartoPrzyciac(RamkaLogo(2, 1, 252, 78), 256, 80))
    }
}
