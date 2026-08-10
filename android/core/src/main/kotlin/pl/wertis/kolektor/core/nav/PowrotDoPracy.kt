package pl.wertis.kolektor.core.nav

/* ── Powrót do aplikacji po przerwie ─────────────────────────────────────────
   ZGŁOSZENIE Z HALI, i to z tych, które kosztują dane: magazynier otworzył kartę
   towaru, przełączył się do innej aplikacji, wrócił po dwudziestu minutach
   i chciał sprawdzić zawartość regału. Zeskanował etykietę półki — ale wciąż był
   na karcie towaru, gdzie skan półki znaczy „ZMIEŃ LOKALIZACJĘ TEGO TOWARU".
   Adres kartoteki zmienił się bez jednego pytania.

   To nie jest wina człowieka. Ekran przetrwał przerwę, a skaner nie ma pojęcia,
   że minęło dwadzieścia minut — zapis lokalizacji jest bezwarunkowy i nie ma po
   nim cofnięcia. Jedyne miejsce, w którym da się to zatrzymać, jest tutaj.

   PRÓG, A NIE „ZAWSZE", i to jest świadomy wybór. Powrót na główny po każdym
   przełączeniu wyrzucałby z rozgrzebanej dostawy za każdym zerknięciem w inną
   aplikację — czyli karałby rytm pracy za czynność, która żadnego ryzyka nie
   niesie. Dwie minuty biorą się z tego, że niebezpieczna jest PRZERWA, po
   której człowiek nie pamięta, co miał na ekranie; przełączenie na kilkanaście
   sekund pamięta się zawsze.

   Ekran główny jest bezpieczny, bo tam skan półki pokazuje jej ZAWARTOŚĆ —
   czyli robi dokładnie to, czego chciał człowiek z tego zgłoszenia.           */

/** Po tylu milisekundach w tle powrót ląduje na ekranie głównym. */
const val PROG_POWROTU_MS = 2 * 60 * 1000L

/**
 * Czy po powrocie z tła wrócić na ekran główny.
 *
 * @param wTleOd znacznik czasu wejścia w tło; `null` = aplikacja nie była w tle
 * @param teraz  bieżący czas (podawany z zewnątrz — testy nie ruszają zegara)
 * @param prog   próg w milisekundach; wystawiony, bo dwie minuty są ZAŁOŻENIEM
 *   wziętym z jednego zgłoszenia, a nie pomiarem
 */
fun wracacNaGlowny(
    wTleOd: Long?,
    teraz: Long,
    prog: Long = PROG_POWROTU_MS,
): Boolean {
    if (wTleOd == null) return false
    /* Zegar urządzenia potrafi skoczyć wstecz (synchronizacja czasu, zmiana
       strefy). Ujemna przerwa nie jest „krótka" — jest NIEZNANA, a przy
       nieznanej wybieramy stronę bezpieczną, czyli powrót na główny. */
    val przerwa = teraz - wTleOd
    if (przerwa < 0) return true
    return przerwa >= prog
}

/**
 * Czy z tego ekranu w ogóle warto wracać.
 *
 * SETUP zostaje, bo to formularz z wpisanymi danymi: wyrzucenie z niego po
 * przerwie kasowałoby pracę, a zakładanie konta nie reaguje na skan półki,
 * więc nie niesie ryzyka, przed którym cała ta reguła chroni.
 */
fun ekranDoOpuszczenia(screen: Screen): Boolean =
    screen != Screen.HOME && screen != Screen.SPLASH && screen != Screen.SETUP
