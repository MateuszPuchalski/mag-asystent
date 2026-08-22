package pl.wertis.kolektor.core.product

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/* Dwie reguły dodawania zdjęcia. Obie są tu dlatego, że ich złamanie NIE
   wywala builda ani nie rzuca wyjątku — widać je dopiero na kolektorze,
   w rękawicy, przy regale. */

class DodanieZdjeciaTest {

    /* NAJWAŻNIEJSZY test w tym pliku. `ZdjeciaRepository.zdjecie()` zwraca
       `null` i przy ładowaniu, i przy braku zdjęcia. Bez rozróżnienia „+"
       mignąłby przy każdym wejściu na kartę — także na kartotece, która
       zdjęcie MA — i przesuwał cele dotyku pod kciukiem. */
    @Test
    fun `przycisk dodania NIE pojawia sie w trakcie ladowania`() {
        assertFalse(pokazacDodanie(StanSlotu.LADOWANIE, dodawanieDostepne = true))
    }

    @Test
    fun `przycisk dodania pojawia sie po potwierdzonym braku`() {
        assertTrue(pokazacDodanie(StanSlotu.BRAK, dodawanieDostepne = true))
    }

    @Test
    fun `kartoteka ze zdjeciem nie proponuje dodania`() {
        assertFalse(pokazacDodanie(StanSlotu.ZDJECIE, dodawanieDostepne = true))
    }

    /* Instalacja bez dodawania zdjęć (ZDJECIA_DODAWANIE puste) nie ma prawa
       pokazać „+": przycisk kończyłby się odmową serwera, a magazynier nie ma
       jak zgadnąć, że funkcji po prostu nie włączono. */
    @Test
    fun `wylaczone dodawanie chowa przycisk we wszystkich stanach`() {
        for (stan in StanSlotu.entries) {
            assertFalse(stan.name, pokazacDodanie(stan, dodawanieDostepne = false))
        }
    }

    /* „ZOSTAW TŁO" przy zdjęciu, z którego tła nie usunięto, proponuje wybór
       między dwiema identycznymi wersjami. Człowiek szuka wtedy różnicy,
       której nie ma. */
    @Test
    fun `zostaw tlo tylko wtedy gdy tlo naprawde usunieto`() {
        assertTrue(pokazacZostawTlo(true))
        assertFalse(pokazacZostawTlo(false))
    }

    @Test
    fun `napis zapisu mowi co zostanie zapisane`() {
        assertEquals("ZAPISZ BEZ TŁA", napisZapisu(true))
        assertEquals("ZAPISZ", napisZapisu(false))
    }
}
