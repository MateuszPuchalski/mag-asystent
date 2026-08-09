package pl.wertis.kolektor.core.product

import pl.wertis.kolektor.core.scan.ScanConfig
import pl.wertis.kolektor.core.scan.ScanKind
import pl.wertis.kolektor.core.scan.ScanRules
import pl.wertis.kolektor.core.scan.classify

/* ── Nadawanie kodu kreskowego kartotece (0.37.0) ────────────────────────────
   Reguła mieszka poza Androidem, bo ma trzy stany prowadzące w RÓŻNE strony,
   a zielony build `:app` nie odróżni ich od siebie:

     UZUPEŁNIENIE — pole puste, jeden skan i gotowe; nic nie ginie.
     PODMIANA     — kartoteka ma już kod. Wymaga świadomego potwierdzenia, bo
                    stary kod zostaje na kartonach w hali i przestanie działać.
     ZAJĘTY       — kod należy do INNEJ kartoteki. Tego NIE DA SIĘ przejść
                    potwierdzeniem: nadanie wyprodukowałoby kolizję (§4.5),
                    czyli defekt, który ten system mierzy i raportuje.

   Zlanie dwóch ostatnich w jedno „na pewno?" byłoby najgorszym z możliwych
   uproszczeń — pytanie wygląda tak samo, a odpowiedź „tak" raz naprawia
   kartotekę, a raz psuje cudzą.                                              */

enum class KrokEan {
    /** Czekamy na kod — skan albo wpisanie z ręki. */
    SKANUJ,

    /** Kod jest, pole puste — wystarczy zatwierdzić. */
    UZUPELNIJ,

    /** Kartoteka ma już kod; pokazujemy STARY → NOWY i pytamy. */
    POTWIERDZ_PODMIANE,

    /** Kod należy do innej kartoteki — droga zamknięta. */
    ZAJETY,
}

/**
 * Walidacja kodu przed wysłaniem — LUSTRO reguły serwera (`bladKodu`).
 *
 * Serwer i tak sprawdza to u siebie i jego odmowa jest rozstrzygająca; ta kopia
 * istnieje po to, żeby magazynier zobaczył błąd BEZ czekania na sieć, stojąc
 * przy regale. Rozjazd obu reguł kosztowałby komunikat „poprawny" na kolektorze
 * i odmowę z serwera sekundę później — dlatego obie wyprowadzone są z tego
 * samego klasyfikatora skanu.
 *
 * `null` znaczy „można wysyłać".
 */
fun bladKoduEan(kod: String, cfg: ScanConfig = ScanRules.current): String? {
    val k = kod.trim()
    if (k.isEmpty()) return "Zeskanuj albo wpisz kod kreskowy"
    return when (classify(k, cfg).kind) {
        ScanKind.LOC -> "To jest adres regału, nie kod towaru"
        ScanKind.EAN -> null
        ScanKind.TEXT -> "Kod ma mieć 8, 12, 13 albo 14 cyfr"
    }
}

/**
 * Krok arkusza dla podanego stanu.
 *
 * @param kod kod zeskanowany/wpisany, pusty dopóki nie ma
 * @param eanKartoteki kod stojący DZIŚ na kartotece (pusty = pole wolne)
 * @param zajetyPrzezInnego czy serwer odmówił z powodem „zajęty"
 */
fun krokEan(kod: String, eanKartoteki: String, zajetyPrzezInnego: Boolean = false): KrokEan = when {
    zajetyPrzezInnego -> KrokEan.ZAJETY
    kod.isBlank() -> KrokEan.SKANUJ
    eanKartoteki.isBlank() -> KrokEan.UZUPELNIJ
    else -> KrokEan.POTWIERDZ_PODMIANE
}

/**
 * Czy ten krok wymaga wysłania flagi `potwierdzone`.
 *
 * Uzupełnienie jej NIE wysyła — i to jest różnica merytoryczna, nie kosmetyczna.
 * Wysyłanie potwierdzenia zawsze znaczyłoby, że kolektor z góry zgadza się na
 * nadpisanie kodu, o którym jeszcze nie wie: gdyby ktoś nadał kod tej kartotece
 * między otwarciem arkusza a zatwierdzeniem, serwer nadpisałby go bez pytania.
 */
fun wymagaPotwierdzenia(krok: KrokEan): Boolean = krok == KrokEan.POTWIERDZ_PODMIANE
