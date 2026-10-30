package pl.wertis.kolektor.core.wymiary

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import pl.wertis.kolektor.core.net.ListaBezWymiarow
import pl.wertis.kolektor.core.net.PomiarBody
import pl.wertis.kolektor.core.net.PozycjaBezWymiarow
import pl.wertis.kolektor.core.net.TowarDoPomiaru
import pl.wertis.kolektor.core.net.WertisJson
import pl.wertis.kolektor.core.net.WymiaryTowaru

/* Formularz pomiaru pisze do kartoteki Subiekta. Pomyłka rzędu wielkości
   (gramy w polu kilogramów) albo puste pole wysłane jako zero psują dane,
   których nikt nie zauważy aż do wyceny przesyłki.                         */

class PomiarTest {

    private val pusty = TowarDoPomiaru(twId = 1, symbol = "AB-1")

    private fun poz(
        twId: Long,
        lok: String? = null,
        oczekuje: Boolean = false,
    ) = PozycjaBezWymiarow(twId = twId, symbol = "S$twId", lokalizacja = lok, oczekuje = oczekuje)

    /* ── Czego brakuje ─────────────────────────────────────────────────────── */

    @Test fun `brak wszystkiego to waga i wymiary`() {
        assertEquals("waga, wymiary", braki(pusty))
    }

    @Test fun `brak samego netto`() {
        val t = pusty.copy(brutto = 1.2, dlugosc = "10", szerokosc = "20", wysokosc = "30")
        assertEquals("netto", braki(t))
    }

    @Test fun `brak samej wysokosci`() {
        val t = pusty.copy(brutto = 1.2, netto = 1.0, dlugosc = "10", szerokosc = "20")
        assertEquals("wysokość", braki(t))
    }

    @Test fun `pusty tekst wymiaru liczy sie jak brak`() {
        // Subiekt trzyma wymiary w polach tekstowych — puste pole to nie wymiar
        val t = pusty.copy(netto = 1.0, dlugosc = "  ", szerokosc = "20", wysokosc = "")
        assertEquals("brutto, długość, wysokość", braki(t))
    }

    @Test fun `pelna kartoteka nie ma brakow`() {
        val t = pusty.copy(brutto = 2.0, netto = 1.5, dlugosc = "1", szerokosc = "2", wysokosc = "3")
        assertEquals("", braki(t))
    }

    /* ── Podpis „W Subiekcie" i pole startowe ──────────────────────────────── */

    @Test fun `podpis pokazuje kilogramy po polsku albo brak`() {
        val t = pusty.copy(brutto = 1.25, dlugosc = "21,5")
        assertEquals("W Subiekcie: 1,25 kg", podpisObecnego(t, PolePomiaru.BRUTTO))
        assertEquals("W Subiekcie: brak", podpisObecnego(t, PolePomiaru.NETTO))
        // wymiar idzie surowo, tak jak go widzi biuro w Subiekcie
        assertEquals("W Subiekcie: 21,5 cm", podpisObecnego(t, PolePomiaru.DLUGOSC))
    }

    @Test fun `kilogramy bez zer na koncu i najwyzej do grama`() {
        assertEquals("2", formatKg(2.0))
        assertEquals("0,5", formatKg(0.5))
        assertEquals("1,235", formatKg(1.2345))
    }

    @Test fun `kursor startuje w pierwszym brakujacym polu`() {
        assertEquals(PolePomiaru.BRUTTO, poleStartowe(pusty))
        assertEquals(PolePomiaru.NETTO, poleStartowe(pusty.copy(brutto = 1.0)))
        val wagi = pusty.copy(brutto = 1.0, netto = 0.8, dlugosc = "10")
        assertEquals(PolePomiaru.SZEROKOSC, poleStartowe(wagi))
    }

    @Test fun `przy pelnej kartotece kursor staje w pierwszym polu`() {
        val t = pusty.copy(brutto = 2.0, netto = 1.5, dlugosc = "1", szerokosc = "2", wysokosc = "3")
        assertEquals(PolePomiaru.BRUTTO, poleStartowe(t))
    }

    @Test fun `dalej prowadzi po kolei, za ostatnim zapis`() {
        assertEquals(PolePomiaru.NETTO, nastepnePole(PolePomiaru.BRUTTO))
        assertEquals(PolePomiaru.WYSOKOSC, nastepnePole(PolePomiaru.SZEROKOSC))
        assertNull(nastepnePole(PolePomiaru.WYSOKOSC))
    }

    /* ── Wpis z klawiatury ─────────────────────────────────────────────────── */

    @Test fun `kropka staje sie przecinkiem`() {
        assertEquals("12,5", wpisLiczby("12.5"))
        assertEquals("12,5", wpisLiczby("12,5"))
    }

    @Test fun `drugi separator i obce znaki odpadaja`() {
        assertEquals("12,53", wpisLiczby("12,5,3"))
        assertEquals("13", wpisLiczby("1e3"))
        assertEquals("125", wpisLiczby(" 1 25 "))
        assertEquals("", wpisLiczby("-"))
    }

    @Test fun `separator na poczatku dostaje zero`() {
        assertEquals("0,5", wpisLiczby(",5"))
    }

    @Test fun `wpis ma limit dlugosci`() {
        assertEquals(MAKS_ZNAKOW_POMIARU, wpisLiczby("1234567890123").length)
    }

    @Test fun `liczba z przecinkiem kropka i spacjami`() {
        assertEquals(12.5, liczbaPomiaru("12,5")!!, 0.0)
        assertEquals(12.5, liczbaPomiaru(" 12.5 ")!!, 0.0)
        assertEquals(1250.0, liczbaPomiaru("1 250")!!, 0.0)
        assertNull(liczbaPomiaru(""))
        assertNull(liczbaPomiaru("12,"))
        assertNull(liczbaPomiaru("abc"))
    }

    /* ── Walidacja — lustro serwera ────────────────────────────────────────── */

    @Test fun `puste pole jest poprawne`() {
        assertNull(bladPola(PolePomiaru.BRUTTO, ""))
        assertNull(bladPola(PolePomiaru.BRUTTO, "   "))
    }

    @Test fun `nie-liczba dostaje zdanie serwera`() {
        assertEquals("Długość: wpisz liczbę, np. 12,5.", bladPola(PolePomiaru.DLUGOSC, "12,"))
    }

    @Test fun `zero po zaokragleniu jest odrzucane`() {
        // 0,04 cm to po zaokrągleniu do milimetra zero
        assertEquals("Wysokość musi być większa od zera.", bladPola(PolePomiaru.WYSOKOSC, "0,04"))
        assertEquals("Waga netto musi być większa od zera.", bladPola(PolePomiaru.NETTO, "0"))
        // gram to już waga
        assertNull(bladPola(PolePomiaru.NETTO, "0,001"))
    }

    @Test fun `ponad granice to pomylka jednostki`() {
        assertEquals("Waga brutto ponad 2000 kg — sprawdź jednostkę.", bladPola(PolePomiaru.BRUTTO, "2000,1"))
        assertNull(bladPola(PolePomiaru.BRUTTO, "2000"))
        assertEquals("Szerokość ponad 1000 cm — sprawdź jednostkę.", bladPola(PolePomiaru.SZEROKOSC, "1001"))
    }

    @Test fun `pusty formularz nie idzie`() {
        val wpisy = PolePomiaru.entries.associateWith { "" }
        assertFalse(cokolwiekWpisane(wpisy))
        assertEquals("Wpisz co najmniej jedną wartość pomiaru.", bladPomiaru(wpisy, pusty))
    }

    @Test fun `netto ponad wpisane brutto`() {
        val wpisy = mapOf(PolePomiaru.BRUTTO to "1", PolePomiaru.NETTO to "1,5")
        assertEquals(
            "Waga netto (1,5 kg) większa od brutto (1 kg) — sprawdź, czy pola nie są zamienione.",
            bladPomiaru(wpisy, pusty),
        )
    }

    @Test fun `netto ponad brutto z kartoteki`() {
        // człowiek wpisał samo netto obok brutto, które już stoi w Subiekcie
        val wpisy = mapOf(PolePomiaru.NETTO to "3")
        val blad = bladPomiaru(wpisy, pusty.copy(brutto = 2.5))
        assertEquals(
            "Waga netto (3 kg) większa od brutto (2,5 kg) — sprawdź, czy pola nie są zamienione.",
            blad,
        )
    }

    @Test fun `poprawny pomiar przechodzi`() {
        val wpisy = mapOf(PolePomiaru.BRUTTO to "1,2", PolePomiaru.WYSOKOSC to "21,5")
        assertTrue(cokolwiekWpisane(wpisy))
        assertNull(bladPomiaru(wpisy, pusty.copy(netto = 1.0)))
    }

    @Test fun `pierwszy blad pola wygrywa z reszta`() {
        val wpisy = mapOf(PolePomiaru.BRUTTO to "0", PolePomiaru.NETTO to "5")
        assertEquals("Waga brutto musi być większa od zera.", bladPomiaru(wpisy, pusty))
    }

    /* ── Ciało żądania ─────────────────────────────────────────────────────── */

    @Test fun `puste pola nie jada wcale`() {
        val cialo = cialoPomiaru(
            mapOf(
                PolePomiaru.BRUTTO to " 1,2 ",
                PolePomiaru.NETTO to "",
                PolePomiaru.DLUGOSC to "21,5",
            ),
        )
        assertEquals(PomiarBody(bruttoKg = "1,2", dlugosc = "21,5"), cialo)
        val json = WertisJson.encodeToString(PomiarBody.serializer(), cialo)
        // brak klucza, a nie `null` — serwer czyta brak jako „zostaw w Subiekcie"
        assertEquals("""{"bruttoKg":"1,2","dlugosc":"21,5"}""", json)
    }

    /* ── Lista ─────────────────────────────────────────────────────────────── */

    @Test fun `strona bez duplikatow po twId`() {
        val razem = dolaczStrone(listOf(poz(1), poz(2)), listOf(poz(2), poz(3)))
        assertEquals(listOf(1L, 2L, 3L), razem.map { it.twId })
    }

    @Test fun `nastepny wolny pomija kolejke i zapisane`() {
        val lista = listOf(poz(1), poz(2, oczekuje = true), poz(3), poz(4))
        assertEquals(4L, nastepnyWolny(lista, poTwId = 1, zapisane = setOf(1L, 3L))?.twId)
    }

    @Test fun `nastepny wolny wraca na gore listy`() {
        val lista = listOf(poz(1), poz(2), poz(3))
        assertEquals(1L, nastepnyWolny(lista, poTwId = 3, zapisane = setOf(3L))?.twId)
    }

    @Test fun `zapisany spoza listy daje pierwszy wolny`() {
        val lista = listOf(poz(1, oczekuje = true), poz(2))
        assertEquals(2L, nastepnyWolny(lista, poTwId = 99, zapisane = emptySet())?.twId)
    }

    @Test fun `brak wolnych to null`() {
        val lista = listOf(poz(1, oczekuje = true), poz(2))
        assertNull(nastepnyWolny(lista, poTwId = 2, zapisane = setOf(2L)))
    }

    @Test fun `skan regalu znajduje towar takze przy kilku adresach`() {
        val lista = listOf(poz(1, "A01-01-01"), poz(2, "B02-01-01  c03-02-01"), poz(3))
        assertEquals(1, indeksRegalu(lista, "c03-02-01"))
        assertEquals(0, indeksRegalu(lista, " a01-01-01 "))
        assertEquals(-1, indeksRegalu(lista, "Z99-99-99"))
        assertEquals(-1, indeksRegalu(lista, ""))
    }

    @Test fun `skan regalu woli wolny towar od zajetego`() {
        val lista = listOf(poz(1, "A01", oczekuje = true), poz(2, "A01"), poz(3, "B01"), poz(4, "B01"))
        assertEquals(1, indeksRegalu(lista, "A01"))
        // zapisany przed chwilą z tego kolektora też jest zajęty
        assertEquals(3, indeksRegalu(lista, "B01", zapisane = setOf(3L)))
        // sam zajęty i tak pokazuje regał
        assertEquals(0, indeksRegalu(listOf(poz(1, "A01", oczekuje = true)), "A01"))
    }

    @Test fun `adresy rozdzielone spacjami`() {
        assertEquals(listOf("A01", "B02"), adresy(" A01   B02 "))
        assertTrue(adresy(null).isEmpty())
        assertTrue(adresy("  ").isEmpty())
    }

    @Test fun `wiecej stron dopoki serwer ma`() {
        assertTrue(jestWiecej(50, 120))
        assertFalse(jestWiecej(120, 120))
    }

    @Test fun `wiersz listy przechodzi do formularza bez strat`() {
        val p = PozycjaBezWymiarow(
            twId = 5, symbol = "X", nazwa = "N", ean = "123", lokalizacja = "A01",
            brutto = 1.0, netto = null, dlugosc = "2", szerokosc = null, wysokosc = "3",
        )
        val t = p.doPomiaru()
        assertEquals(TowarDoPomiaru(5, "X", "N", "123", "A01", 1.0, null, "2", null, "3"), t)
    }

    /* ── DTO ───────────────────────────────────────────────────────────────── */

    @Test fun `lista z serwera sie dekoduje`() {
        val json = """
            {"wlaczone":true,"razem":2,"pozycje":[
              {"twId":7,"symbol":"AB-1","nazwa":"Łańcuch","ean":null,"stan":3,"sprzedaz":12,
               "lokalizacja":"A01-02-03 B01-01-01","brutto":1.25,"netto":null,
               "dlugosc":"21,5","szerokosc":null,"wysokosc":null,"oczekuje":false}]}
        """.trimIndent()
        val l = WertisJson.decodeFromString(ListaBezWymiarow.serializer(), json)
        assertTrue(l.wlaczone)
        assertEquals(2, l.razem)
        assertEquals("21,5", l.pozycje[0].dlugosc)
        assertEquals(1.25, l.pozycje[0].brutto!!, 0.0)
        assertEquals("netto, szerokość, wysokość", braki(l.pozycje[0].doPomiaru()))
    }

    @Test fun `wylaczona funkcja niesie powod`() {
        val json = """{"wlaczone":false,"powod":"Brak pól własnych w Subiekcie","razem":0,"pozycje":[]}"""
        val l = WertisJson.decodeFromString(ListaBezWymiarow.serializer(), json)
        assertFalse(l.wlaczone)
        assertEquals("Brak pól własnych w Subiekcie", l.powod)
    }

    @Test fun `odpowiedz towaru sie dekoduje`() {
        val json = """
            {"wlaczone":true,"oczekuje":true,"towar":{"twId":7,"symbol":"AB-1","nazwa":"Ł",
             "ean":"5901234123457","lokalizacja":null,"brutto":null,"netto":0.5,
             "dlugosc":null,"szerokosc":"3","wysokosc":null}}
        """.trimIndent()
        val w = WertisJson.decodeFromString(WymiaryTowaru.serializer(), json)
        assertTrue(w.oczekuje)
        assertEquals(0.5, w.towar!!.netto!!, 0.0)
        assertEquals(PolePomiaru.BRUTTO, poleStartowe(w.towar!!))
    }
}
