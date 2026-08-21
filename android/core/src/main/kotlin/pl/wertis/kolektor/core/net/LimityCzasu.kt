package pl.wertis.kolektor.core.net

/* ── Które żądanie wolno pobierać długo ──────────────────────────────────────
   Powstało ze zgłoszenia z hali: „pobieranie jest bardzo wolne i dostaję
   timeout". Nie chodziło o przepustowość — kolektor pobiera strumieniem,
   a serwer strumieniem wysyła. Chodziło o LIMIT CZASU.

   Cała aplikacja chodzi na jednym kliencie OkHttp z limitem odczytu 10 s,
   i to jest wartość celowa: ekrany odpytują serwer co 1,5–2 s, więc dziesięć
   sekund ciszy przy żądaniu o kilka kilobajtów JSON-a naprawdę znaczy „sieci
   nie ma". Kolektor ma to wykryć szybko, stojąc przy regale.

   Tym samym klientem idzie jednak APK ważący kilkanaście megabajtów. Tam
   dziesięć sekund bez bajtu nie znaczy nic złego — na obciążonym Wi-Fi,
   zwłaszcza przy przeskoku między punktami dostępowymi, taka przerwa jest
   normalna. Ten sam limit opisuje więc dwie zupełnie różne sytuacje.

   REGUŁA MIESZKA W `:core`, choć używa jej wyłącznie warstwa sieciowa `:app`.
   Powód jest jeden: pomyłka w dopasowaniu ścieżki jest CICHA. Limit zostałby
   wtedy krótki, pobieranie dalej urywałoby się timeoutem, a kod wyglądałby na
   naprawiony. Test jednostkowy jest jedyną rzeczą, która to wyłapie — i tu da
   się go uruchomić bez CI.                                                    */

/**
 * Czy ta ścieżka niesie plik, a nie odpowiedź ekranu.
 *
 * Dopasowanie po KOŃCU ścieżki, bo wołający podaje raz `api/aktualizacja/apk`,
 * a raz `/api/aktualizacja/apk` — zależnie od tego, czy pyta Retrofit, czy
 * gotowy `HttpUrl`. Porównanie z wiodącym ukośnikiem przepuściłoby jedno
 * i odrzuciło drugie, czyli zadziałałoby losowo.
 *
 * Lista jest krótka z rozmysłu. Zdjęcia kartotek i logo dostawców też są
 * obrazami, ale ważą kilkadziesiąt kilobajtów i pobiera się je w tle przy
 * rysowaniu listy — tam krótki limit jest ZALETĄ, bo pusta miniatura jest
 * nieszkodliwa, a zawieszone żądanie zajmuje połączenie.
 */
fun dlugiePobranie(sciezka: String): Boolean =
    sciezka.trimEnd('/').endsWith("api/aktualizacja/apk")
