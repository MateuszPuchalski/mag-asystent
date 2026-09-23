package pl.wertis.kolektor.core.delivery

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import pl.wertis.kolektor.core.net.LocApplyAction

/* Rozjazd pyta raz na parę adresów, nie raz na pozycję — ale ZAMIEŃ tylko
   w obrębie jednego towaru. Reguła jest krótka, ale stała w korutynie zapisu
   wewnątrz composable'a — czyli nigdzie, gdzie dałoby się ją sprawdzić.     */

class PamiecRozjazduTest {

    private val kosa = 101L
    private val grabie = 202L

    @Test fun `zgodny adres nie pyta o nic`() {
        assertTrue(PamiecRozjazdu().rozstrzygnij(kosa, "A01-02-03", "A01-02-03") is DecyzjaRozjazdu.Zgodna)
    }

    @Test fun `kartoteka bez adresu nie ma z czym sie rozjechac`() {
        // Pozycja bez `locExpected` to SKU wymagające decyzji, a nie rozjazd —
        // pytanie ZAMIEŃ/DODAJ nie miałoby tu treści
        val p = PamiecRozjazdu()
        assertTrue(p.rozstrzygnij(kosa, null, "B02-01-01") is DecyzjaRozjazdu.Zgodna)
        assertTrue(p.rozstrzygnij(kosa, "", "B02-01-01") is DecyzjaRozjazdu.Zgodna)
        assertTrue(p.rozstrzygnij(kosa, "   ", "B02-01-01") is DecyzjaRozjazdu.Zgodna)
    }

    @Test fun `pierwszy rozjazd pyta`() {
        assertTrue(PamiecRozjazdu().rozstrzygnij(kosa, "A01-02-03", "B02-01-01") is DecyzjaRozjazdu.Zapytaj)
    }

    @Test fun `DODAJ DLA DRUGIEJ POZYCJI Z TEGO SAMEGO KARTONU JUZ NIE PYTA`() {
        // dziesięć pozycji dokładanych na tę samą „inną" półkę to jedna decyzja
        val p = PamiecRozjazdu()
        p.zapamietaj(kosa, "A01-02-03", "B02-01-01", LocApplyAction.ADD)
        val d = p.rozstrzygnij(grabie, "A01-02-03", "B02-01-01")
        assertEquals(LocApplyAction.ADD, (d as DecyzjaRozjazdu.Powtorz).akcja)
    }

    @Test fun `ZAMIEN NIE PRZECHODZI NA INNY TOWAR`() {
        // Sedno poprawki z audytu: ZAMIEŃ kasuje adres pickingowy, więc
        // powtórzone za człowieka o cudzym towarze byłoby cichą pomyłką
        val p = PamiecRozjazdu()
        p.zapamietaj(kosa, "A01-02-03", "B02-01-01", LocApplyAction.REPLACE)
        assertTrue(p.rozstrzygnij(grabie, "A01-02-03", "B02-01-01") is DecyzjaRozjazdu.Zapytaj)
    }

    @Test fun `ZAMIEN powtarza sie dla tego samego towaru`() {
        // druga partia tego samego towaru na tę samą półkę — to ta sama decyzja
        val p = PamiecRozjazdu()
        p.zapamietaj(kosa, "A01-02-03", "B02-01-01", LocApplyAction.REPLACE)
        val d = p.rozstrzygnij(kosa, "A01-02-03", "B02-01-01")
        assertEquals(LocApplyAction.REPLACE, (d as DecyzjaRozjazdu.Powtorz).akcja)
    }

    @Test fun `INNA PARA ADRESOW PYTA NORMALNIE`() {
        val p = PamiecRozjazdu()
        p.zapamietaj(kosa, "A01-02-03", "B02-01-01", LocApplyAction.ADD)
        assertTrue(p.rozstrzygnij(kosa, "C03-01-01", "B02-01-01") is DecyzjaRozjazdu.Zapytaj)
        assertTrue(p.rozstrzygnij(kosa, "A01-02-03", "D04-01-01") is DecyzjaRozjazdu.Zapytaj)
    }

    @Test fun `zmiana zdania dla towaru nadpisuje jego odpowiedz`() {
        val p = PamiecRozjazdu()
        p.zapamietaj(kosa, "A01-02-03", "B02-01-01", LocApplyAction.ADD)
        p.zapamietaj(kosa, "A01-02-03", "B02-01-01", LocApplyAction.REPLACE)
        assertEquals(
            LocApplyAction.REPLACE,
            (p.rozstrzygnij(kosa, "A01-02-03", "B02-01-01") as DecyzjaRozjazdu.Powtorz).akcja,
        )
        p.zapamietaj(kosa, "A01-02-03", "B02-01-01", LocApplyAction.ADD)
        assertEquals(
            LocApplyAction.ADD,
            (p.rozstrzygnij(kosa, "A01-02-03", "B02-01-01") as DecyzjaRozjazdu.Powtorz).akcja,
        )
    }

    @Test fun `pusty adres oczekiwany nie trafia do pamieci`() {
        // Klucz bez adresu zbierałby wszystkie pozycje bez kartoteki pod jedną
        // decyzję — a każda z nich jest osobnym pytaniem
        val p = PamiecRozjazdu()
        p.zapamietaj(kosa, null, "B02-01-01", LocApplyAction.ADD)
        assertTrue(p.rozstrzygnij(kosa, "A01-02-03", "B02-01-01") is DecyzjaRozjazdu.Zapytaj)
    }

    @Test fun `pamiec jednej dostawy nie przechodzi do drugiej`() {
        // Instancja żyje `remember(id)` — nowa dostawa dostaje nową pamięć,
        // bo to rozstrzygnięcie o TAMTYM kartonie
        val pierwsza = PamiecRozjazdu()
        pierwsza.zapamietaj(kosa, "A01-02-03", "B02-01-01", LocApplyAction.ADD)
        assertTrue(PamiecRozjazdu().rozstrzygnij(kosa, "A01-02-03", "B02-01-01") is DecyzjaRozjazdu.Zapytaj)
    }
}
