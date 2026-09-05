package pl.wertis.kolektor.core.delivery

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import pl.wertis.kolektor.core.net.LocApplyAction

/* Rozjazd pyta raz na parę adresów, nie raz na pozycję. Reguła jest krótka,
   ale stała w korutynie zapisu wewnątrz composable'a — czyli nigdzie, gdzie
   dałoby się ją sprawdzić.                                                    */

class PamiecRozjazduTest {

    @Test fun `zgodny adres nie pyta o nic`() {
        assertTrue(PamiecRozjazdu().rozstrzygnij("A01-02-03", "A01-02-03") is DecyzjaRozjazdu.Zgodna)
    }

    @Test fun `kartoteka bez adresu nie ma z czym sie rozjechac`() {
        // Pozycja bez `locExpected` to SKU wymagające decyzji, a nie rozjazd —
        // pytanie ZAMIEŃ/DODAJ nie miałoby tu treści
        val p = PamiecRozjazdu()
        assertTrue(p.rozstrzygnij(null, "B02-01-01") is DecyzjaRozjazdu.Zgodna)
        assertTrue(p.rozstrzygnij("", "B02-01-01") is DecyzjaRozjazdu.Zgodna)
        assertTrue(p.rozstrzygnij("   ", "B02-01-01") is DecyzjaRozjazdu.Zgodna)
    }

    @Test fun `pierwszy rozjazd pyta`() {
        assertTrue(PamiecRozjazdu().rozstrzygnij("A01-02-03", "B02-01-01") is DecyzjaRozjazdu.Zapytaj)
    }

    @Test fun `DRUGA POZYCJA Z TEGO SAMEGO KARTONU JUZ NIE PYTA`() {
        // Sedno klasy: dziesięć pozycji na tę samą „inną" półkę to jedna
        // decyzja, nie dziesięć
        val p = PamiecRozjazdu()
        p.zapamietaj("A01-02-03", "B02-01-01", LocApplyAction.REPLACE)
        val d = p.rozstrzygnij("A01-02-03", "B02-01-01")
        assertEquals(LocApplyAction.REPLACE, (d as DecyzjaRozjazdu.Powtorz).akcja)
    }

    @Test fun `INNA PARA ADRESOW PYTA NORMALNIE`() {
        // Pamięć jest o parze, nie o dostawie. Rozstrzygnięcie „towar z A01
        // przeniesiono na B02" nie mówi nic o towarze z C03.
        val p = PamiecRozjazdu()
        p.zapamietaj("A01-02-03", "B02-01-01", LocApplyAction.REPLACE)
        assertTrue(p.rozstrzygnij("C03-01-01", "B02-01-01") is DecyzjaRozjazdu.Zapytaj)
        assertTrue(p.rozstrzygnij("A01-02-03", "D04-01-01") is DecyzjaRozjazdu.Zapytaj)
    }

    @Test fun `DODAJ zapamietuje sie tak samo jak ZAMIEN`() {
        val p = PamiecRozjazdu()
        p.zapamietaj("A01-02-03", "B02-01-01", LocApplyAction.ADD)
        val d = p.rozstrzygnij("A01-02-03", "B02-01-01")
        assertEquals(LocApplyAction.ADD, (d as DecyzjaRozjazdu.Powtorz).akcja)
    }

    @Test fun `zmiana zdania nadpisuje poprzednia odpowiedz`() {
        val p = PamiecRozjazdu()
        p.zapamietaj("A01-02-03", "B02-01-01", LocApplyAction.ADD)
        p.zapamietaj("A01-02-03", "B02-01-01", LocApplyAction.REPLACE)
        val d = p.rozstrzygnij("A01-02-03", "B02-01-01")
        assertEquals(LocApplyAction.REPLACE, (d as DecyzjaRozjazdu.Powtorz).akcja)
    }

    @Test fun `pusty adres oczekiwany nie trafia do pamieci`() {
        // Klucz bez adresu zbierałby wszystkie pozycje bez kartoteki pod jedną
        // decyzję — a każda z nich jest osobnym pytaniem
        val p = PamiecRozjazdu()
        p.zapamietaj(null, "B02-01-01", LocApplyAction.REPLACE)
        assertTrue(p.rozstrzygnij("A01-02-03", "B02-01-01") is DecyzjaRozjazdu.Zapytaj)
    }

    @Test fun `pamiec jednej dostawy nie przechodzi do drugiej`() {
        // Instancja żyje `remember(id)` — nowa dostawa dostaje nową pamięć,
        // bo to rozstrzygnięcie o TAMTYM kartonie
        val pierwsza = PamiecRozjazdu()
        pierwsza.zapamietaj("A01-02-03", "B02-01-01", LocApplyAction.REPLACE)
        assertTrue(PamiecRozjazdu().rozstrzygnij("A01-02-03", "B02-01-01") is DecyzjaRozjazdu.Zapytaj)
    }
}
