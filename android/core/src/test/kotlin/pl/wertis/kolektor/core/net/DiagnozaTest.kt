package pl.wertis.kolektor.core.net

import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/* Ekran diagnostyki ma powiedzieć, CZEGO szukać. Zdanie, które źle nazywa
   przyczynę, jest gorsze niż brak zdania — wysyła człowieka do przestawiania
   sieci, która jest dobra, podczas gdy prawdziwa przyczyna zostaje. Dlatego
   testy pilnują obu stron: i tego, co ekran twierdzi, i tego, czego świadomie
   NIE twierdzi. */

class DiagnozaTest {

    @Test fun `ta sama podsiec rozstrzyga sie po trzech pierwszych liczbach`() {
        assertTrue(tasamaPodsiec("192.168.10.57", "192.168.10.4") == true)
        assertFalse(tasamaPodsiec("192.168.20.57", "192.168.10.4") == true)
    }

    @Test fun `serwer podany nazwa to NIE WIADOMO, nie zla podsiec`() {
        /* Instalacja z `DEPLOY.md` używa `mag.wertis.local`. Udawanie
           odpowiedzi kazałoby przestawiać dobrą sieć. */
        assertNull(tasamaPodsiec("192.168.10.57", "mag.wertis.local"))
        assertNull(tasamaPodsiec(null, "192.168.10.4"))
    }

    @Test fun `adres spoza IPv4 nie udaje porownania`() {
        assertNull(tasamaPodsiec("fe80::1", "192.168.10.4"))
        assertNull(tasamaPodsiec("192.168.10.999", "192.168.10.4"))
        assertNull(tasamaPodsiec("192.168.10", "192.168.10.4"))
    }

    @Test fun `host wychodzi z adresu w kazdej postaci`() {
        assertEquals("192.168.10.4", hostSerwera("http://192.168.10.4:3001"))
        assertEquals("mag.wertis.local", hostSerwera("http://mag.wertis.local:3001/"))
        assertEquals("10.0.2.2", hostSerwera("10.0.2.2:3001"))
    }

    @Test fun `pusty adres nie wywraca ekranu diagnostyki`() {
        /* Adres wpisuje człowiek w Ustawieniach, więc przychodzi tu w każdej
           postaci. Ekran mający tłumaczyć awarię nie ma być drugą awarią. */
        assertNull(hostSerwera(""))
        assertNull(hostSerwera("   "))
    }

    @Test fun `kazdy powod prowadzi do INNEJ czynnosci`() {
        assertTrue(powodOdmowy(SocketTimeoutException()).contains("zapora"))
        assertTrue(powodOdmowy(ConnectException()).contains("nic nie nasłuchuje"))
        assertTrue(powodOdmowy(UnknownHostException()).contains("DNS"))
        assertTrue(powodOdmowy(ApiError(503, "serwer w restarcie")).contains("503"))
    }

    @Test fun `cisza to JEDNA przerwa, a nie trzynascie wpisow po pol torej sekundy`() {
        /* Bez sklejania dwudziestosekundowa cisza zepchnęłaby z listy całą
           historię — czyli dziennik gubiłby ją dokładnie wtedy, gdy jest
           potrzebna. */
        val d = DziennikCiszy()
        d.porazka(1_000, "cisza")
        d.porazka(2_500, "cisza")
        d.porazka(4_000, "cisza")

        assertEquals(1, d.przerwy().size)
        assertEquals(3, d.przerwy().first().prob)
        assertTrue(d.trwaPrzerwa())
    }

    @Test fun `pierwsza udana proba zamyka przerwe`() {
        val d = DziennikCiszy()
        d.porazka(1_000, "cisza")
        d.sukces(7_000)

        val p = d.przerwy().first()
        assertEquals(1_000L, p.odKiedy)
        assertEquals(7_000L, p.doKiedy)
        assertFalse(d.trwaPrzerwa())
    }

    @Test fun `sukces bez przerwy niczego nie zapisuje`() {
        /* Pętla kolejki melduje sukces co 1,5 s przez całą zmianę. Zapis każdego
           z nich zamieniłby dziennik w strumień i wypchnął z niego przerwy. */
        val d = DziennikCiszy()
        d.sukces(1_000)
        d.sukces(2_500)
        assertTrue(d.przerwy().isEmpty())
    }

    @Test fun `druga przerwa jest osobnym wpisem, najnowsza na gorze`() {
        val d = DziennikCiszy()
        d.porazka(1_000, "pierwsza")
        d.sukces(2_000)
        d.porazka(9_000, "druga")

        assertEquals(2, d.przerwy().size)
        assertEquals("druga", d.przerwy()[0].powod)
        assertEquals("pierwsza", d.przerwy()[1].powod)
    }

    @Test fun `tylko przerwa ZAKONCZONA i dosc dluga idzie do dziennika serwera`() {
        /* Trwająca nie zna jeszcze swojego czasu i nie ma czym pojechać.
           Krótka nie dotarła do nikogo przy regale, a `events` nie ma
           retencji — sto wpisów „bywa słabo" zakopuje jeden ważny. */
        val d = DziennikCiszy()
        d.porazka(1_000, "krótka")
        d.sukces(1_000 + PROG_ZGLOSZENIA_MS - 1)
        assertTrue(d.doWyslania().isEmpty())

        d.porazka(50_000, "długa")
        assertTrue("trwająca nie ma czym pojechać", d.doWyslania().isEmpty())
        d.sukces(50_000 + PROG_ZGLOSZENIA_MS)
        assertEquals(1, d.doWyslania().size)
        assertEquals("długa", d.doWyslania().first().powod)
    }

    @Test fun `sukces mowi, czy WLASNIE domknal przerwe`() {
        /* Wołający wysyła zaległości dokładnie wtedy, gdy to `true`. Sukces
           pada co półtorej sekundy przez całą zmianę i nie ma o czym meldować. */
        val d = DziennikCiszy()
        assertFalse("bez przerwy nie ma czego domykać", d.sukces(1_000))
        d.porazka(2_000, "cisza")
        assertTrue(d.sukces(9_000))
        assertFalse("drugi sukces z rzędu już niczego nie domyka", d.sukces(9_100))
    }

    @Test fun `odhaczona przerwa nie jedzie drugi raz`() {
        val d = DziennikCiszy()
        d.porazka(1_000, "cisza")
        d.sukces(30_000)
        val p = d.doWyslania().single()

        d.oznaczWyslana(p.odKiedy)
        assertTrue(d.doWyslania().isEmpty())
        /* Na ekranie zostaje — wysłanie nie jest powodem do zapomnienia. */
        assertEquals(1, d.przerwy().size)
        assertTrue(d.przerwy().first().wyslana)
    }

    @Test fun `nieudana wysylka zostawia przerwe w kolejce`() {
        /* Odhaczenie idzie PO udanej odpowiedzi serwera. Odwrotna kolejność
           gubiłaby dokładnie te przerwy, które trafiły w chwiejną sieć. */
        val d = DziennikCiszy()
        d.porazka(1_000, "pierwsza")
        d.sukces(30_000)
        d.porazka(60_000, "druga")
        d.sukces(90_000)

        assertEquals(2, d.doWyslania().size)
        d.oznaczWyslana(1_000)
        assertEquals(1, d.doWyslania().size)
        assertEquals("druga", d.doWyslania().first().powod)
    }

    @Test fun `dziennik ma sufit i gubi NAJSTARSZE`() {
        val d = DziennikCiszy(maks = 3)
        for (i in 1..5) {
            d.porazka(i * 1_000L, "przerwa $i")
            d.sukces(i * 1_000L + 500)
        }
        assertEquals(3, d.przerwy().size)
        assertEquals("przerwa 5", d.przerwy().first().powod)
        assertEquals("przerwa 3", d.przerwy().last().powod)
    }
}
