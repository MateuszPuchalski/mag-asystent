package pl.wertis.kolektor.core.net

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/* Ta reguła psuje się CICHO. Zbyt wąskie dopasowanie zostawia krótki limit,
   pobieranie dalej urywa się timeoutem, a kod wygląda na naprawiony. Zbyt
   szerokie robi coś gorszego: odbiera kolektorowi szybkie wykrywanie martwej
   sieci przy regale, czyli psuje rzecz używaną co dwie sekundy, żeby naprawić
   rzecz zdarzającą się raz na wydanie. Testy pilnują OBU stron. */

class LimityCzasuTest {

    @Test fun `trasa APK dostaje dlugi limit`() {
        assertTrue(dlugiePobranie("api/aktualizacja/apk"))
    }

    @Test fun `wiodacy ukosnik nie zmienia odpowiedzi`() {
        // Retrofit podaje ścieżkę bez ukośnika, gotowy HttpUrl z ukośnikiem
        assertTrue(dlugiePobranie("/api/aktualizacja/apk"))
        assertTrue(dlugiePobranie("http://192.168.1.49:3001/api/aktualizacja/apk"))
    }

    @Test fun `koncowy ukosnik nie zmienia odpowiedzi`() {
        assertTrue(dlugiePobranie("/api/aktualizacja/apk/"))
    }

    @Test fun `trasy odpytywane co dwie sekundy zostaja przy krotkim limicie`() {
        /* To jest ważniejsza połowa testu: te ścieżki lecą po kilkaset razy na
           zmianę, a długi limit zamieniłby martwe Wi-Fi w minutę czekania. */
        for (s in listOf(
            "api/health",
            "api/delivery/12",
            "api/products/900019",
            "api/aktualizacja",
            "api/products/7/zdjecie",
            "api/dostawcy/500/logo",
        )) {
            assertFalse("nie powinna dostać długiego limitu: $s", dlugiePobranie(s))
        }
    }

    @Test fun `sama pytanie o aktualizacje to nie plik`() {
        // `api/aktualizacja` zwraca kilkadziesiąt bajtów JSON-a i pada przy
        // KAŻDYM otwarciu aplikacji — długi limit byłby tu czystą stratą
        assertFalse(dlugiePobranie("api/aktualizacja"))
    }

    @Test fun `pusta sciezka nie wybucha`() {
        assertFalse(dlugiePobranie(""))
        assertFalse(dlugiePobranie("/"))
    }
}
