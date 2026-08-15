package pl.wertis.kolektor.core.product

import pl.wertis.kolektor.core.scan.ScanConfig
import pl.wertis.kolektor.core.scan.ScanKind
import pl.wertis.kolektor.core.scan.ScanRules
import pl.wertis.kolektor.core.scan.classify

/* ── Nadawanie kodu kreskowego kartotece (0.37.0) ────────────────────────────
   Reguła mieszka poza Androidem, bo jej stany prowadzą w RÓŻNE strony,
   a zielony build `:app` nie odróżni ich od siebie:

     ZAPIS   — kod jest; nadanie i podmiana idą jednym zatwierdzeniem.
               Do 0.49.0 podmiana miała osobny krok potwierdzenia — zdjęty na
               polecenie właściciela. Arkusz nadal POKAZUJE „STARY → NOWY",
               tylko już o nic nie dopytuje.
     ZAJĘTY  — kod należy do INNEJ kartoteki. Tego NIE DA SIĘ przejść żadnym
               potwierdzeniem: nadanie wyprodukowałoby kolizję (§4.5), czyli
               defekt, który ten system mierzy i raportuje.

   ZAJĘTY zostaje osobnym stanem świadomie: odpowiedź „tak" na pytanie o
   podmianę naprawia kartotekę, a ta sama odpowiedź przy kodzie zajętym
   psułaby cudzą.                                                             */

enum class KrokEan {
    /** Czekamy na kod — skan albo wpisanie z ręki. */
    SKANUJ,

    /** Kod jest — wystarczy zatwierdzić (nadanie i podmiana tak samo). */
    UZUPELNIJ,

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
 * Kartoteka z kodem i bez kodu dają ten sam krok — od 0.49.0 podmiana nie ma
 * osobnego potwierdzenia. Informację „STARY → NOWY" arkusz wyprowadza sam
 * z `eanKartoteki`; reguła nie musi jej niczym sygnalizować.
 *
 * @param kod kod zeskanowany/wpisany, pusty dopóki nie ma
 * @param zajetyPrzezInnego czy serwer odmówił z powodem „zajęty"
 */
fun krokEan(kod: String, zajetyPrzezInnego: Boolean = false): KrokEan = when {
    zajetyPrzezInnego -> KrokEan.ZAJETY
    kod.isBlank() -> KrokEan.SKANUJ
    else -> KrokEan.UZUPELNIJ
}
