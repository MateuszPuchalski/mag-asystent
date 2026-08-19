package pl.wertis.kolektor.core.problem

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class ProblemModelTest {

    /** Klucze muszą pokrywać się z PROBLEM_TYPES na serwerze — inaczej 400 w alejce. */
    @Test fun `klucze protokolu to piec kategorii formularza`() {
        assertEquals(
            setOf("wrong_item", "missing_item", "damaged", "qty_mismatch", "extra_item"),
            ProblemType.entries.map { it.key }.toSet(),
        )
    }

    /**
     * Kolejność jest TREŚCIĄ, dlatego ma własny test.
     *
     * „Zła ilość" pierwsza, bo w 0.57.0 zniknął skrót INNA ILOŚĆ, który dawał
     * jej osobny przycisk w panelu odkładania. Przesunięcie jej dalej cofa
     * tamtą zmianę po cichu — arkusz nadal się skompiluje i nikt nie zauważy.
     */
    @Test fun `zla ilosc jest pierwsza na liscie dla pozycji`() {
        assertEquals(ProblemType.QTY_MISMATCH, ProblemType.dozwolone(dlaPozycji = true).first())
    }

    @Test fun `pozycja dostaje cztery kategorie, dostawa jedna`() {
        assertEquals(
            listOf("qty_mismatch", "missing_item", "damaged", "wrong_item"),
            ProblemType.dozwolone(dlaPozycji = true).map { it.key },
        )
        assertEquals(
            listOf("extra_item"),
            ProblemType.dozwolone(dlaPozycji = false).map { it.key },
        )
    }

    /** Każda kategoria należy do dokładnie jednego zakresu — bez „i tak, i tak". */
    @Test fun `zakresy sie nie przecinaja i pokrywaja calosc`() {
        val pozycja = ProblemType.dozwolone(dlaPozycji = true).toSet()
        val dostawa = ProblemType.dozwolone(dlaPozycji = false).toSet()
        assertEquals(emptySet<ProblemType>(), pozycja intersect dostawa)
        assertEquals(ProblemType.entries.toSet(), pozycja union dostawa)
    }

    /**
     * Zakres blokuje w OBIE strony. Druga połowa tej reguły jest nowa w 0.57.0
     * i to ona zamyka dziurę: „artykuł niezamówiony" dawało się przypiąć do
     * pozycji faktury i ustawić jej status „problem".
     */
    @Test fun `kategoria dostawy odmawia przy wskazanej pozycji`() {
        assertNotNull(
            problemBlocker(ProblemType.EXTRA_ITEM, qty = 1.0, hasPhoto = true, symObcy = "X", lineId = 7L),
        )
        assertNull(
            problemBlocker(ProblemType.EXTRA_ITEM, qty = 1.0, hasPhoto = true, symObcy = "X", lineId = null),
        )
    }

    @Test fun `kazda kategoria pozycji odmawia bez wskazanej pozycji`() {
        ProblemType.dozwolone(dlaPozycji = true).forEach { t ->
            assertNotNull(
                "${t.key} przepuszcza zgłoszenie bez pozycji",
                problemBlocker(t, qty = 1.0, hasPhoto = true, symObcy = "X", nrPrzesylki = "1", lineId = null),
            )
        }
    }

    @Test fun `zdjecie obowiazkowe tam gdzie jest dowodem`() {
        val needPhoto = ProblemType.entries.filter { it.photoRequired }.map { it.key }.toSet()
        assertEquals(setOf("damaged", "wrong_item"), needPhoto)
    }

    /** Formularz żąda ilości w każdej z pięciu kategorii — bez wyjątków. */
    @Test fun `kazda kategoria wymaga ilosci`() {
        ProblemType.entries.forEach { t ->
            assertNotNull(
                "${t.key} przepuszcza zgłoszenie bez ilości",
                problemBlocker(t, qty = null, hasPhoto = true, symObcy = "X", nrPrzesylki = "1", lineId = 1L),
            )
        }
    }

    /** Artykuł spoza dokumentu nie ma linii, z której dałoby się odczytać symbol. */
    @Test fun `artykul spoza dokumentu wymaga numeru katalogowego`() {
        val needSym = ProblemType.entries.filter { it.symObcyRequired }.map { it.key }.toSet()
        assertEquals(setOf("wrong_item", "extra_item"), needSym)

        assertNotNull(
            problemBlocker(ProblemType.EXTRA_ITEM, qty = 2.0, hasPhoto = false, symObcy = "  "),
        )
        assertNull(
            problemBlocker(ProblemType.EXTRA_ITEM, qty = 2.0, hasPhoto = false, symObcy = "K-1099"),
        )
    }

    /* `lineId` jest tu podane wszędzie, bo od 0.57.0 należy do kompletności
       zgłoszenia tak samo jak zdjęcie: obie te kategorie mają zakres POZYCJA.
       Ich brak sprawdza osobny test wyżej. */
    @Test fun `blocker tlumaczy czego brakuje`() {
        // uszkodzenie bez zdjęcia to opinia, nie zgłoszenie
        assertNotNull(
            problemBlocker(ProblemType.DAMAGED, qty = 1.0, hasPhoto = false, nrPrzesylki = "1", lineId = 1L),
        )
        assertNull(
            problemBlocker(ProblemType.DAMAGED, qty = 1.0, hasPhoto = true, nrPrzesylki = "1", lineId = 1L),
        )

        // ilość ujemna nie istnieje na palecie
        assertNotNull(problemBlocker(ProblemType.MISSING_ITEM, qty = -1.0, hasPhoto = false, lineId = 1L))

        // zero jest legalne: „nie przyszło nic z zamówionych pięciu"
        assertNull(problemBlocker(ProblemType.MISSING_ITEM, qty = 0.0, hasPhoto = false, lineId = 1L))
    }

    /** Uszkodzenie bez numeru przesyłki nie ma czego wysłać przewoźnikowi. */
    @Test fun `uszkodzenie pyta o numer przesylki`() {
        assertNotNull(
            problemBlocker(ProblemType.DAMAGED, qty = 1.0, hasPhoto = true, nrPrzesylki = null, lineId = 1L),
        )
        assertNull(
            problemBlocker(
                ProblemType.DAMAGED, qty = 1.0, hasPhoto = true, nrPrzesylki = "00159876543", lineId = 1L,
            ),
        )

        // pozostałe kategorie o przesyłkę nie pytają — to pole formularza
        // należy wyłącznie do uszkodzenia w transporcie
        assertNull(
            problemBlocker(ProblemType.MISSING_ITEM, qty = 1.0, hasPhoto = false, nrPrzesylki = null, lineId = 1L),
        )
    }

    /** „Zła ilość" porównuje z dokumentem, więc bez pozycji nie ma z czym. */
    @Test fun `zla ilosc dotyczy pozycji z dokumentu`() {
        assertNotNull(problemBlocker(ProblemType.QTY_MISMATCH, qty = 3.0, hasPhoto = false, lineId = null))
        assertNull(problemBlocker(ProblemType.QTY_MISMATCH, qty = 3.0, hasPhoto = false, lineId = 7L))
    }

    @Test fun `etykieta nieznanego klucza nie wybucha`() {
        assertEquals("Uszkodzone w transporcie", ProblemType.labelOf("damaged"))
        assertEquals("cos_nowego", ProblemType.labelOf("cos_nowego"))
    }

    /**
     * Wyjątki sprzed 0.21.0 zostają w bazie na zawsze. Lista nierozwiązanych
     * pokazałaby bez tego surowy klucz `qty_short` — a to nie jest zdanie,
     * które da się przeczytać w alejce.
     */
    @Test fun `stary klucz ma etykiete choc nie da sie go juz zglosic`() {
        assertEquals("Za mało", ProblemType.labelOf("qty_short"))
        assertEquals("Kolizja EAN", ProblemType.labelOf("ean_conflict"))
        assertEquals(emptyList<String>(), ProblemType.entries.map { it.key }.filter { it == "qty_short" })
    }
}
