package pl.wertis.kolektor.core.cache

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import pl.wertis.kolektor.core.net.ProductCard
import pl.wertis.kolektor.core.net.ProductRow
import pl.wertis.kolektor.core.net.StockView

class CardsRepositoryTest {

    private val stock = StockView(0.0, 0.0, 0.0, 0.0, 0.0, 0.0)
    private fun card(id: Long) = ProductCard(
        id = id, sym = "W32-$id", name = "Towar $id", ean = "", unit = "szt",
        mag = stock, mgp = stock,
    )
    private fun row(id: Long) = ProductRow(id, "W32-$id", "Towar $id", "", 0.0, 0.0)

    @Test fun `ostatnia wersja karty wygrywa`() {
        val c = CardsRepository()
        c.putCard(card(1))
        c.putCard(card(1).copy(name = "świeższa"))
        assertEquals("świeższa", c.peekCard(1)?.name)
    }

    @Test fun `klucz polki jest normalizowany jak w nawigacji`() {
        /* ScanRouter zapisuje kod z odpowiedzi serwera, LocationScreen pyta
           kodem z nawigacji (trim + uppercase) — oba muszą trafiać w ten sam
           wpis, inaczej posiew nigdy nie działa. */
        val c = CardsRepository()
        c.putLocation(" a01-02-03 ", listOf(row(1)))
        assertEquals(1, c.peekLocation("A01-02-03")?.size)
    }

    @Test fun `najdawniej uzywana karta wypada po przekroczeniu pojemnosci`() {
        val c = CardsRepository()
        (1L..30L).forEach { c.putCard(card(it)) }
        c.peekCard(1) // dotknięcie odświeża pozycję w LRU
        c.putCard(card(31))
        assertNull("nietykana najdłużej", c.peekCard(2))
        assertEquals(1L, c.peekCard(1)?.id)
    }

    @Test fun `zmiana serwera oproznia wszystko`() {
        val c = CardsRepository()
        c.putCard(card(1))
        c.putLocation("A01-02-03", listOf(row(1)))
        c.putHistory(1, emptyList())
        c.clear()
        assertNull(c.peekCard(1))
        assertNull(c.peekLocation("A01-02-03"))
        assertNull(c.peekHistory(1))
    }
}
