package pl.wertis.kolektor.core.product

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import pl.wertis.kolektor.core.net.MagazynStan
import pl.wertis.kolektor.core.net.MovementEntry
import pl.wertis.kolektor.core.net.PendingLocChange
import pl.wertis.kolektor.core.net.ProductRow
import pl.wertis.kolektor.core.net.WDostawie
import pl.wertis.kolektor.core.net.Zamienniki
import pl.wertis.kolektor.core.net.ZamowioneUDostawcy
import java.time.ZoneId

class KartaTekstTest {

    /* ── linie faktów ─────────────────────────────────────────────────────── */

    @Test fun `dostawa - numer i ilosc bez statusu`() {
        val d = WDostawie(nrPelny = "FZ 214/07/2026", dataWyst = "2026-07-24", ilosc = 6.0)
        assertEquals("W dostawie 6 szt — FZ 214/07/2026", liniaWDostawie(d, "szt"))
    }

    @Test fun `dostawa - status dopisany za numerem`() {
        val d = WDostawie(nrPelny = "FZ 214/07/2026", ilosc = 6.0, status = "open")
        assertEquals("W dostawie 6 szt — FZ 214/07/2026 · w toku", liniaWDostawie(d, "szt"))
    }

    @Test fun `dostawa - dostawca miedzy numerem a statusem`() {
        // dostawca prowadzi do palety w przyjęciach, status mówi, czy ktoś już
        // się o nią potknął — i dlatego status zostaje ostatni
        val d = WDostawie(nrPelny = "FZ 214/07/2026", ilosc = 6.0, dostawca = "OGRÓD-POL", status = "open")
        assertEquals("W dostawie 6 szt — FZ 214/07/2026 · OGRÓD-POL · w toku", liniaWDostawie(d, "szt"))
    }

    @Test fun `dostawa - dokument bez kontrahenta nie zostawia pustego czlonu`() {
        val d = WDostawie(nrPelny = "FZ 214/07/2026", ilosc = 6.0, dostawca = "", status = "open")
        assertEquals("W dostawie 6 szt — FZ 214/07/2026 · w toku", liniaWDostawie(d, "szt"))
    }

    @Test fun `dostawa - zgloszony problem i pominiecie maja wlasne dopiski`() {
        assertEquals("zgłoszony problem", opisStatusu(WDostawie(status = "problem")))
        assertEquals("pominięte przy rozkładaniu", opisStatusu(WDostawie(status = "skipped")))
        assertEquals("dokument w buforze", opisStatusu(WDostawie(wBuforze = true)))
        assertNull(opisStatusu(WDostawie()))
    }

    @Test fun `dostawa - pusta jednostka nie zostawia podwojnej spacji`() {
        val d = WDostawie(nrPelny = "PZ 3/2026", ilosc = 2.5)
        assertEquals("W dostawie 2.5 — PZ 3/2026", liniaWDostawie(d, ""))
    }

    @Test fun `zamowienie - termin przed dostawca`() {
        val z = ZamowioneUDostawcy(nrPelny = "ZD 12/2026", termin = "04.08", dostawca = "OGRÓD-POL", ilosc = 10.0)
        assertEquals("Zamówione 10 szt — 04.08 · OGRÓD-POL", liniaZamowione(z, "szt"))
    }

    @Test fun `zamowienie - brak terminu mowi to wprost`() {
        val z = ZamowioneUDostawcy(nrPelny = "ZD 12/2026", termin = null, dostawca = "OGRÓD-POL", ilosc = 10.0)
        assertEquals("Zamówione 10 szt — termin nieznany · OGRÓD-POL", liniaZamowione(z, "szt"))
        val pusty = z.copy(termin = "  ")
        assertEquals("Zamówione 10 szt — termin nieznany · OGRÓD-POL", liniaZamowione(pusty, "szt"))
    }

    @Test fun `zamowienie - bez dostawcy konczy sie na terminie`() {
        val z = ZamowioneUDostawcy(termin = "04.08", ilosc = 1.0)
        assertEquals("Zamówione 1 szt — 04.08", liniaZamowione(z, "szt"))
    }

    /* ── podsumowania zwiniętych sekcji ───────────────────────────────────── */

    @Test fun `historia - wczytywanie i pustka to rozne stany`() {
        assertEquals("wczytuję…", podsumowanieHistorii(null))
        assertNull(podsumowanieHistorii(emptyList()))
    }

    @Test fun `historia - ostatni wpis z data bez roku`() {
        val h = listOf(
            MovementEntry("location_set", "Jan K", "2026-07-28 09:14:03", "Lokalizacja → A01-02-03"),
            MovementEntry("scan", "Piotr M", "2026-07-22 11:30:00", "Rozłożono 6 szt"),
        )
        assertEquals("ost. Jan K · 07-28", podsumowanieHistorii(h))
        // znacznik BEZ strefy: nie ma czego przeliczać, pokazujemy co przyszło
        assertEquals("09:14", czasKrotki(h.first().at))
    }

    @Test fun `czas z serwera jest UTC i ma byc pokazany lokalnie`() {
        // POWSTAŁO PO ZGŁOSZENIU „logi są dwie godziny do tyłu". Serwer zapisuje
        // UTC, a kolektor pokazywał wycinek tego ciągu — czyli godzinę
        // z Greenwich przy zegarze wskazującym czas polski.
        val warszawa = ZoneId.of("Europe/Warsaw")
        assertEquals("lato = UTC+2", "11:14", czasKrotki("2026-07-28T09:14:03.000Z", warszawa))
        assertEquals("zima = UTC+1", "10:14", czasKrotki("2026-01-28T09:14:03.000Z", warszawa))
    }

    @Test fun `data z konca doby UTC nalezy juz do nastepnego dnia lokalnie`() {
        // Wpis o 23:30 czasu polskiego ma w bazie 21:30 UTC TEGO SAMEGO dnia,
        // ale wpis o 01:30 lokalnie ma 23:30 UTC dnia POPRZEDNIEGO — i to on
        // pokazywał się w historii z wczorajszą datą.
        val warszawa = ZoneId.of("Europe/Warsaw")
        assertEquals("07-29", dataKrotka("2026-07-28T23:30:00.000Z", warszawa))
        assertEquals("01:30", czasKrotki("2026-07-28T23:30:00.000Z", warszawa))
    }

    @Test fun `magazyny - kod i stan po przecinku srodkowym`() {
        val m = listOf(
            MagazynStan(magId = 4, kod = "SKLEP", nazwa = "Sklep firmowy", stan = 3.0),
            MagazynStan(magId = 5, kod = "SERWIS", nazwa = "Warsztat serwisowy", stan = 0.0),
        )
        assertEquals("SKLEP 3 · SERWIS 0", podsumowanieMagazynow(m))
    }

    @Test fun `magazyny - osiem magazynow skraca sie do dwoch i plus N`() {
        val m = (1..8).map { MagazynStan(magId = it.toLong(), kod = "M$it", stan = it.toDouble()) }
        assertEquals("M1 1 · M2 2 · +6", podsumowanieMagazynow(m))
    }

    @Test fun `magazyny - zwroty ida pierwsze i tylko z niezerowym stanem`() {
        val m = listOf(MagazynStan(magId = 4, kod = "SKLEP", stan = 3.0))
        assertEquals("ZWROTY 2 · SKLEP 3", podsumowanieMagazynow(m, zwroty = 2.0))
        assertEquals("SKLEP 3", podsumowanieMagazynow(m, zwroty = 0.0))
    }

    @Test fun `magazyny - brak czegokolwiek chowa sekcje`() {
        assertNull(podsumowanieMagazynow(emptyList()))
    }

    @Test fun `zamienniki - pierwszy znany z jego stanem`() {
        val z = Zamienniki(znane = listOf(row("24-04003", 4.0)), obce = listOf("OEM 742-04058"))
        assertEquals("24-04003 · MAG 4", podsumowanieZamiennikow(z, desc = "Zamiennik: 24-04003"))
    }

    @Test fun `zamienniki - kolejne znane liczone bez liczebnika`() {
        val z = Zamienniki(znane = listOf(row("24-04003", 4.0), row("101-024", 0.0)))
        assertEquals("24-04003 · MAG 4 · +1", podsumowanieZamiennikow(z, desc = ""))
    }

    @Test fun `zamienniki - same numery obce albo sam opis`() {
        assertEquals("numery obce", podsumowanieZamiennikow(Zamienniki(obce = listOf("MTD 942")), ""))
        assertEquals("opis", podsumowanieZamiennikow(Zamienniki(), "Pasuje do S461."))
        assertNull(podsumowanieZamiennikow(Zamienniki(), ""))
    }

    /* ── pastylka adresu ──────────────────────────────────────────────────── */

    @Test fun `pastylka - pierwszy adres jest pickingowy`() {
        val a = adresHero(listOf("A01-02-03", "B04-01-05"), emptyList())
        assertEquals("A01-02-03", a.kod)
        assertNull(a.zmiana)
    }

    @Test fun `pastylka - niesie stan zapisu swojego adresu`() {
        val zmiana = PendingLocChange(code = "A01-02-03", kind = "remove", status = "error")
        val a = adresHero(listOf("A01-02-03"), listOf(zmiana))
        assertEquals("error", a.zmiana?.status)
    }

    @Test fun `pastylka - bez adresow pokazuje dochodzacy`() {
        val a = adresHero(emptyList(), listOf(PendingLocChange(code = "C02-01-04", kind = "add")))
        assertEquals("C02-01-04", a.kod)
        assertEquals("add", a.zmiana?.kind)
    }

    @Test fun `pastylka - dochodzacy nie wypiera istniejacego adresu`() {
        // Chip dochodzący zostaje wtedy w rzędzie pod spodem — to jedyne
        // miejsce, gdzie logika pastylki i chipów się rozjeżdża.
        val a = adresHero(listOf("A01-02-03"), listOf(PendingLocChange(code = "C02-01-04", kind = "add")))
        assertEquals("A01-02-03", a.kod)
        assertNull(a.zmiana)
    }

    @Test fun `pastylka - brak adresu i brak kolejki`() {
        assertEquals("", adresHero(emptyList(), emptyList()).kod)
    }

    private fun row(sym: String, mag: Double) =
        ProductRow(id = 1, sym = sym, name = "Nóż 52 cm", ean = "", mag = mag, mgp = 0.0)
}
