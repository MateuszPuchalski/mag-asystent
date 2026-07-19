package pl.wertis.kolektor.core.nav

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class NavModelTest {

    @Test fun `statyczna mapa powrotow`() {
        assertEquals(Screen.HOME, backTarget(Screen.PRODUCT, null))
        assertEquals(Screen.PRODUCT, backTarget(Screen.SCAN_LOC, null))
        assertEquals(Screen.PRODUCT, backTarget(Screen.MM, null))
        assertEquals(Screen.PUTAWAY_DOCS, backTarget(Screen.PUTAWAY_SESSION, null))
        assertEquals(Screen.HOME, backTarget(Screen.LOCATION, null))
        assertEquals(Screen.HOME, backTarget(Screen.SETTINGS, null))
    }

    @Test fun `ekrany bazowe bez powrotu`() {
        assertNull(backTarget(Screen.SPLASH, null))
        assertNull(backTarget(Screen.HOME, null))
        assertNull(backTarget(Screen.PUTAWAY_DOCS, null))
    }

    @Test fun `kolejka wraca tam skad ja otwarto`() {
        assertEquals(Screen.PUTAWAY_SESSION, backTarget(Screen.QUEUE, Screen.PUTAWAY_SESSION))
        assertEquals(Screen.PRODUCT, backTarget(Screen.QUEUE, Screen.PRODUCT))
        assertEquals(Screen.HOME, backTarget(Screen.QUEUE, null))
    }
}
