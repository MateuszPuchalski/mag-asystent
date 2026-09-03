package pl.wertis.kolektor.core.kosze

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/* Drugi skan towaru kończy odłożenie. Każdy test to jeden sposób, w jaki ta
   wygoda mogłaby odłożyć towar, którego nikt nie chciał odłożyć.            */

class SkanKoszaTest {

    @Test fun `drugi skan tej samej pozycji odklada`() {
        assertTrue(czyPotwierdzaOdlozenie(7L, uzbrojona = 7L, adres = "A01-02-03", odstepMs = 1_500))
    }

    @Test fun `pierwszy skan tylko wskazuje`() {
        /* Nic jeszcze nie uzbroiło tej pozycji — skan ma ją wskazać, a nie
           domknąć pracę, której człowiek nie zaczął. */
        assertFalse(czyPotwierdzaOdlozenie(7L, uzbrojona = null, adres = "A01-02-03", odstepMs = 5_000))
    }

    @Test fun `pozycja wskazana automatem NIE liczy sie jako pierwszy skan`() {
        /* Po każdym odłożeniu ekran sam wskazuje następną. Gdyby liczyło się
           samo wskazanie, magazynier podchodzący z towarem odłożyłby go
           PIERWSZYM skanem — zanim zdążył sprawdzić, co trzyma. Automat
           zostawia `uzbrojona` puste i to jest cała różnica. */
        assertFalse(czyPotwierdzaOdlozenie(7L, uzbrojona = null, adres = "A01-02-03", odstepMs = 9_999))
    }

    @Test fun `skan innej pozycji przestawia wskazanie, nie odklada`() {
        assertFalse(czyPotwierdzaOdlozenie(8L, uzbrojona = 7L, adres = "A01-02-03", odstepMs = 1_500))
    }

    @Test fun `dubel ze spustu skanera nie odklada`() {
        // ten sam kod dwa razy w 200 ms to sprzęt, nie decyzja człowieka
        assertFalse(czyPotwierdzaOdlozenie(7L, uzbrojona = 7L, adres = "A01-02-03", odstepMs = 200))
        // granica progu wpada do środka — 800 ms JUŻ liczy się jako drugi skan
        assertTrue(czyPotwierdzaOdlozenie(7L, uzbrojona = 7L, adres = "A01", odstepMs = PROG_DRUGIEGO_SKANU))
    }

    @Test fun `bez adresu nie ma czego potwierdzac`() {
        // towar bez półki w kartotece wymaga wpisania jej ręką, tak jak przy przycisku
        assertFalse(czyPotwierdzaOdlozenie(7L, uzbrojona = 7L, adres = "", odstepMs = 3_000))
        assertFalse(czyPotwierdzaOdlozenie(7L, uzbrojona = 7L, adres = "   ", odstepMs = 3_000))
    }
}
