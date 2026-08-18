package pl.wertis.kolektor.core.update

/* ── Czy warto się zaktualizować (0.48.0) ───────────────────────────────────
   Reguła jest jedna i twarda: PRZY KAŻDEJ WĄTPLIWOŚCI ODPOWIADAMY „NIE".
   Zaproponowana wersja starsza od zainstalowanej kosztuje pełne odinstalowanie
   aplikacji razem z buforem offline, więc niepewność ma tu milczeć, a nie
   zgadywać.

   Porównujemy LICZBAMI, nie napisami — po napisach `0.10.0` wychodzi starsze
   niż `0.9.0`, czyli aktualizacja po dziesiątym wydaniu przestałaby się
   pokazywać i nikt nie umiałby powiedzieć dlaczego.                          */

/** Ten sam wzór, co `versionCode` w `android/app/build.gradle.kts`. */
private val WZORZEC = Regex("""^(\d+)\.(\d+)\.(\d+)$""")

/**
 * Numer wersji → liczba porównywalna. `null` = nie rozumiem tego napisu.
 *
 * Trzy różnice wobec bliźniaczego wyliczenia w Gradle'u, każda celowa:
 *
 * 1. Śmieci ODRZUCAMY zamiast czytać jako zero. Gradle robi `toIntOrNull() ?: 0`
 *    przy budowaniu, z człowiekiem patrzącym na wynik; tutaj liczba powstaje
 *    na kolektorze, gdzie `0.4x.0` po cichu zamieniłoby się w `400` i kazało
 *    zainstalować wersję starszą od zainstalowanej.
 * 2. Człon powyżej 99 odrzucamy, bo wzór go zwija: `0.47.100` i `0.48.0` dają
 *    tę samą liczbę. Kolizja czyta się jako „ta sama wersja", więc aktualizacja
 *    znikałaby z ekranu zamiast być błędna głośno.
 * 3. Wymagamy dokładnie trzech członów — `0.48` to śmieć, nie `0.48.0`.
 */
fun kodWersji(wersja: String?): Int? {
    val czysta = wersja?.trim()?.substringBefore('-') ?: return null
    val m = WZORZEC.matchEntire(czysta) ?: return null
    val (major, minor, patch) = m.destructured
    val mi = minor.toIntOrNull() ?: return null
    val pa = patch.toIntOrNull() ?: return null
    val ma = major.toIntOrNull() ?: return null
    if (mi > 99 || pa > 99) return null
    return ma * 10_000 + mi * 100 + pa
}

/**
 * Czy serwer ma dla nas coś nowszego.
 *
 * Wersja RÓWNA to `false`. Aktualizacja do tego samego numeru wygląda dla
 * człowieka jak pętla: pobiera, instaluje i widzi tę samą propozycję.
 */
fun wartoAktualizowac(zainstalowana: String?, naSerwerze: String?): Boolean {
    val mam = kodWersji(zainstalowana) ?: return false
    val jest = kodWersji(naSerwerze) ?: return false
    return jest > mam
}

/**
 * Czy odpowiedź serwera nadaje się do pobrania.
 *
 * Pusta suma albo zerowy rozmiar znaczą, że po drugiej stronie coś jest nie
 * tak — a bez sumy nie ma czym sprawdzić pobranego pliku, więc instalowalibyśmy
 * cokolwiek przyszło.
 */
fun mozliwaDoPobrania(bajtow: Long, sha256: String?): Boolean =
    bajtow > 0 && !sha256.isNullOrBlank()

/** Porównanie sum kontrolnych — wielkość liter i spacje nie są tu różnicą. */
fun zgodnaSuma(oczekiwana: String?, policzona: String?): Boolean {
    val a = oczekiwana?.trim()?.lowercase().orEmpty()
    val b = policzona?.trim()?.lowercase().orEmpty()
    return a.isNotEmpty() && a == b
}

/** Rozmiar do pokazania człowiekowi. „18 MB" mówi więcej niż 18 234 112. */
fun rozmiarMb(bajtow: Long): String = "${(bajtow + 524_288) / 1_048_576} MB"
