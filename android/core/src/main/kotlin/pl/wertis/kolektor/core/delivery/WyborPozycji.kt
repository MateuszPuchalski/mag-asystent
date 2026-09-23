package pl.wertis.kolektor.core.delivery

/* ── Która pozycja otwiera się po wejściu z karty towaru ────────────────────
   Karta towaru ma przycisk „W dostawie …". Człowiek wskazał już konkretny
   towar, więc szukanie go drugi raz na liście trzydziestu pozycji byłoby karą
   za trafny klik.

   Reguła stoi tutaj, a nie w ekranie, bo ma pułapkę niewidoczną przy jednym
   przejściu: TEN SAM TOWAR POTRAFI STAĆ W DOKUMENCIE W DWÓCH WIERSZACH
   (scenariusz S26). Otwarcie pierwszego z brzegu trafiało wtedy w wiersz
   odłożony albo z wyjątkiem — czyli w robotę, której nie ma, przy drugim
   wierszu czekającym obok.                                                    */

/**
 * Wiersz do otwarcia dla wskazanego towaru; `null` — nie ma go w dokumencie.
 *
 * Pierwszeństwo ma wiersz, przy którym JEST co robić (`todo` albo `partial`).
 * Dopiero gdy takiego nie ma, otwieramy pierwszy z brzegu: pozycja odłożona
 * też bywa celem (poprawka ilości, druga półka), a milczenie po kliknięciu
 * jest gorsze niż otwarcie wiersza zamkniętego — człowiek widzi wtedy, że
 * trafił tam, gdzie chciał.
 *
 * @param twIdPozycji funkcja wyciągająca identyfikator towaru z wiersza
 * @param status funkcja wyciągająca status wiersza (`DeliveryLineView.status`)
 */
fun <T> wybierzPozycjeTowaru(
    pozycje: List<T>,
    twId: Long,
    twIdPozycji: (T) -> Long,
    status: (T) -> String,
): T? {
    val kandydaci = pozycje.filter { twIdPozycji(it) == twId }
    return kandydaci.firstOrNull {
        status(it) == StatusLinii.TODO || status(it) == StatusLinii.PARTIAL
    } ?: kandydaci.firstOrNull()
}

/**
 * Pozycja dostawy po kodzie ze skanu — z listy w pamięci, BEZ SERWERA.
 *
 * Bufor offline umiał zapisać odłożenie, ale rozpoznanie towaru szło wyłącznie
 * do serwera. W martwej strefie Wi-Fi skan nie otwierał więc pozycji, a bufor
 * ratował tylko tę otwartą przed zanikiem sieci (audyt z 22 września 2026).
 * Ekran woła tę funkcję wyłącznie wtedy, gdy serwer nie odpowiada.
 *
 * Kod pasuje po symbolu (bez wielkości liter) albo po kodach kreskowych, które
 * serwer podaje z listą. Kod wskazujący DWA różne towary daje `null`: kolizję
 * EAN rozstrzyga człowiek z listą kandydatów (D7), a tej bez sieci nie ma.
 * Wiersz spośród kilku tego samego towaru wybiera ta sama reguła S26 co wyżej.
 */
fun <T> pozycjaPoKodzie(
    pozycje: List<T>,
    kod: String,
    twIdPozycji: (T) -> Long,
    symbol: (T) -> String,
    kody: (T) -> List<String>,
    status: (T) -> String,
): T? {
    val k = kod.trim()
    if (k.isEmpty()) return null
    val towary = pozycje
        .filter { symbol(it).equals(k, ignoreCase = true) || k in kody(it) }
        .map(twIdPozycji)
        .distinct()
    if (towary.size != 1) return null
    return wybierzPozycjeTowaru(pozycje, towary.single(), twIdPozycji, status)
}
