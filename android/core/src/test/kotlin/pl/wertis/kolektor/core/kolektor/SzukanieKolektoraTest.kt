package pl.wertis.kolektor.core.kolektor

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import pl.wertis.kolektor.core.net.KolektorView
import pl.wertis.kolektor.core.net.KolektoryResponse
import pl.wertis.kolektor.core.net.WertisJson
import pl.wertis.kolektor.core.net.WezwanieKolektora

class SzukanieKolektoraTest {

    private fun k(
        id: String,
        zalogowany: Boolean = true,
        slucha: Boolean = false,
        wezwanie: WezwanieKolektora? = null,
    ) = KolektorView(id, etykietaKolektora(id), "Jan", zalogowany, null, slucha, wezwanie)

    private val w = WezwanieKolektora("Ola", "2026-09-23T08:00:00.000Z", "2026-09-23T08:05:00.000Z")

    @Test fun `etykieta taka sama jak na serwerze`() {
        // te same trzy przypadki stoją w services/szukanie-kolektora.test.ts
        assertEquals("#A3F9", etykietaKolektora("3f2a9c1e-7b4d-4e0a-9f1b-0c2d5e6fa3f9"))
        assertEquals("#2107", etykietaKolektora("TC21-07"))
        assertEquals("#????", etykietaKolektora("---"))
    }

    @Test fun `samego siebie nie ma na liscie, kolejnosc zostaje`() {
        val lista = listOf(k("kol-a"), k("kol-ten"), k("kol-b"))
        assertEquals(listOf("kol-a", "kol-b"), doWyboru(lista, "kol-ten").map { it.deviceId })
        assertEquals(3, doWyboru(lista, null).size)
    }

    @Test fun `opis mowi, czy warto isc nasluchiwac`() {
        assertEquals("DZWONI · wezwał(a) Ola", opisKolektora(k("a", wezwanie = w.copy(odebrane = true))))
        assertEquals("czeka, aż kolektor zapyta (do 10 s)", opisKolektora(k("a", wezwanie = w)))
        assertEquals("wylogowany — nie zadzwoni", opisKolektora(k("a", zalogowany = false, slucha = true)))
        assertEquals("słucha — zadzwoni od razu", opisKolektora(k("a", slucha = true)))
        assertEquals("cisza — uśpiony albo bez baterii", opisKolektora(k("a")))
    }

    @Test fun `ZNALAZLEM gasi to wezwanie, ale nie nastepne`() {
        assertFalse(maDzwonic(null, null))
        assertTrue(maDzwonic(w, null))
        // odnalezienie nie doszło do serwera — to samo wezwanie wraca, cisza zostaje
        assertFalse(maDzwonic(w, w.od))
        // ktoś wezwał od nowa: inny znacznik, syrena gra
        assertTrue(maDzwonic(w.copy(od = "2026-09-23T09:00:00.000Z"), w.od))
    }

    @Test fun `bez sieci syrena gasnie o czasie z serwera, a nieczytelna data jej nie gasi`() {
        val koniec = java.time.Instant.parse(w.doKiedy).toEpochMilli()
        assertFalse(wygaslo(w, koniec - 1))
        assertTrue(wygaslo(w, koniec))
        assertFalse(wygaslo(w.copy(doKiedy = "jutro"), Long.MAX_VALUE))
    }

    @Test fun `odpowiedz serwera czyta sie z pola osoba`() {
        /* Pole nazywa się tu inaczej niż na drucie (`@SerialName`). Literówka
           w adnotacji dałaby na liście same kreski zamiast nazwisk — bez
           błędu, bo `ignoreUnknownKeys` połyka nieznane pole po cichu. */
        val json = """{"kolektory":[{"deviceId":"kol-a3f9","etykieta":"#A3F9","osoba":"Jan",
            "zalogowany":true,"ostatnioWidziany":"2026-09-23T08:00:00.000Z","slucha":true,
            "wezwanie":{"przez":"Ola","od":"2026-09-23T08:00:00.000Z","doKiedy":"2026-09-23T08:05:00.000Z","odebrane":true}}],
            "ten":"kol-oli"}"""
        val r = WertisJson.decodeFromString(KolektoryResponse.serializer(), json)
        assertEquals("Jan", r.kolektory.single().ostatniaOsoba)
        assertEquals("kol-oli", r.ten)
        assertTrue(r.kolektory.single().wezwanie!!.odebrane)
    }
}
