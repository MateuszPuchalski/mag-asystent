package pl.wertis.kolektor.core.net

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CzasyZadanTest {

    @Test fun `trasa bez identyfikatorow i zapytania - ta sama regula co na serwerze`() {
        // te same przypadki stoją w services/ergonomia.test.ts
        assertEquals("/api/delivery/:x/lines/:x/cofnij", wzorTrasy("/api/delivery/12/lines/34/cofnij"))
        assertEquals("/api/products/scan/:x", wzorTrasy("/api/products/scan/A01-02-03?manual=1"))
        assertEquals("/api/kolektor/wezwanie", wzorTrasy("/api/kolektor/wezwanie"))
    }

    @Test fun `granice kubelkow wlacznie, ponad ostatnia osobny kubelek`() {
        assertEquals(0, kubelek(0))
        assertEquals(0, kubelek(100))
        assertEquals(1, kubelek(101))
        assertEquals(2, kubelek(300))
        assertEquals(3, kubelek(301))
        assertEquals(5, kubelek(1001))
    }

    @Test fun `zrzut sumuje po ekranie i trasie, a potem zeruje`() {
        val l = LicznikCzasow()
        l.zapisz("DELIVERY_LINES", "/api/delivery/1/lines/2/putaway", 90)
        l.zapisz("DELIVERY_LINES", "/api/delivery/7/lines/8/putaway", 450)
        l.zapisz("HOME", "/api/products/scan/590", 120)
        val z = l.zrzut()
        assertEquals(2, z.size)
        val putaway = z.first { it.ekran == "DELIVERY_LINES" }
        assertEquals("/api/delivery/:x/lines/:x/putaway", putaway.trasa)
        assertEquals(2, putaway.n)
        assertEquals(listOf(1, 0, 0, 1, 0, 0), putaway.kubelki)
        assertTrue("drugi zrzut nie wysyła tego samego drugi raz", l.zrzut().isEmpty())
    }

    @Test fun `nieudana wysylka wraca do licznika i dolicza sie do nowych pomiarow`() {
        val l = LicznikCzasow()
        l.zapisz("HOME", "/api/x", 50)
        val z = l.zrzut()
        l.zapisz("HOME", "/api/x", 700)
        l.oddaj(z)
        val w = l.zrzut().single()
        assertEquals(2, w.n)
        assertEquals(listOf(1, 0, 0, 0, 1, 0), w.kubelki)
    }

    @Test fun `nie mierzymy telemetrii, tla ani pobran plikow`() {
        assertTrue(mierzyc("/api/delivery/1/lines/2/putaway"))
        assertFalse(mierzyc("/api/device/event"))
        assertFalse(mierzyc("/api/kolektor/wezwanie"))
        assertFalse(mierzyc("/api/aktualizacja/apk"))
        assertFalse(mierzyc("/obsluga/index.html"))
    }
}
