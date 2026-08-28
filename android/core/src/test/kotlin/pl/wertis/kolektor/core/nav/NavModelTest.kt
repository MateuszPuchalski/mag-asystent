package pl.wertis.kolektor.core.nav

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class NavModelTest {

    @Test fun `statyczna mapa powrotow`() {
        assertEquals(Screen.HOME, backTarget(Screen.PRODUCT, null))
        assertEquals(Screen.PRODUCT, backTarget(Screen.SCAN_LOC, null))
        // dokument dostawy → lista dostaw; kontener idzie tą samą drogą
        assertEquals(Screen.DELIVERY_DOCS, backTarget(Screen.DELIVERY_LINES, null))
        // kosz zwrotów → lista przyjęć, czyli korzeń WŁASNEJ zakładki (0.75.0);
        // wcześniej wracał na dostawy, bo tam mieszkała lista koszy
        assertEquals(Screen.PRZYJECIA, backTarget(Screen.KOSZ_LINES, null))
        assertEquals(Screen.KARTONY, backTarget(Screen.KARTON, null))
        assertEquals(Screen.HOME, backTarget(Screen.LOCATION, null))
        assertEquals(Screen.HOME, backTarget(Screen.SETTINGS, null))
    }

    @Test fun `ekrany bazowe bez powrotu`() {
        assertNull(backTarget(Screen.SPLASH, null))
        assertNull(backTarget(Screen.HOME, null))
        // korzeń zakładki „DOSTAWY"
        assertNull(backTarget(Screen.DELIVERY_DOCS, null))
        // korzeń zakładki „ZWROTY"
        assertNull(backTarget(Screen.PRZYJECIA, null))
        // korzeń zakładki „KARTON"
        assertNull(backTarget(Screen.KARTONY, null))
    }

    @Test fun `kolejka wraca tam skad ja otwarto`() {
        assertEquals(Screen.DELIVERY_LINES, backTarget(Screen.QUEUE, Screen.DELIVERY_LINES))
        assertEquals(Screen.PRODUCT, backTarget(Screen.QUEUE, Screen.PRODUCT))
        assertEquals(Screen.HOME, backTarget(Screen.QUEUE, null))
    }
}
