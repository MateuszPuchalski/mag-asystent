package pl.wertis.kolektor.core.product

import kotlinx.serialization.Serializable

/* ── Reguły cache'u zdjęć kartotek ───────────────────────────────────────────
   Czysta logika, bez Androida, sieci i dysku — po to, żeby dwie decyzje, na
   których stoi cała funkcja, dało się przetestować na JVM:

   1. KIEDY w ogóle sięgamy do sieci. Karta towaru jest odpytywana co 2 s
      (ProductScreen), a zdjęcie ma jechać przez Wi-Fi RAZ na towar. Gdyby ta
      reguła siedziała w repozytorium razem z I/O, jedynym sposobem na
      sprawdzenie byłby ruch na hali.
   2. CO wypada przy przepełnieniu. Po ostatnim UŻYCIU, nie po pobraniu —
      inaczej zdjęcie oglądane codziennie wypadałoby tylko dlatego, że
      pobrano je jako pierwsze.                                                */

/** Co wiemy o zdjęciu jednego towaru. */
@Serializable
data class WpisZdjecia(
    /** ETag z serwera — po nim idzie rewalidacja kończąca się na 304. */
    val etag: String = "",
    val bajtow: Int = 0,
    /** Kiedy serwer potwierdził świeżość (200 albo 304). */
    val sprawdzono: Long = 0,
    /** Ostatnie wyświetlenie — po tym idzie eviction. */
    val uzyto: Long = 0,
    /** Serwer odpowiedział 404: ta kartoteka zdjęcia NIE MA. */
    val brak: Boolean = false,
)

/** Co zrobić przy wejściu na kartę. */
sealed interface DecyzjaZdjecia {
    /** Nic nie wiemy albo plik przepadł — pobierz od zera. */
    data object Pobierz : DecyzjaZdjecia

    /** Mamy plik, ale minął czas — zapytaj z `If-None-Match`. */
    data class Rewaliduj(val etag: String) : DecyzjaZdjecia

    /** Plik jest i jest świeży — SIECI NIE DOTYKAMY. */
    data object UzyjLokalnego : DecyzjaZdjecia

    /** Wiemy, że tej kartoteki zdjęcie nie dotyczy. */
    data object NieMa : DecyzjaZdjecia
}

/** Jak długo ufamy plikowi bez pytania serwera. */
const val SWIEZOSC_MS: Long = 6 * 60 * 60 * 1000

/**
 * Jak długo pamiętamy, że zdjęcia nie ma.
 *
 * Krócej niż świeżość pliku i to jest celowe: zdjęcie DODANE dziś w Subiekcie
 * ma się pojawić najdalej jutro, bez przeinstalowania i bez czyszczenia danych.
 */
const val NEGATYW_MS: Long = 24 * 60 * 60 * 1000

/**
 * Decyzja bez sieci i bez dysku.
 *
 * @param maPlik czy plik faktycznie leży w katalogu — wpis bez pliku znaczy,
 *   że eviction wyprzedził odczyt albo system posprzątał; wtedy pobieramy
 *   ponownie zamiast pokazywać pustkę
 */
fun decyzja(wpis: WpisZdjecia?, maPlik: Boolean, teraz: Long): DecyzjaZdjecia {
    if (wpis == null) return DecyzjaZdjecia.Pobierz
    if (wpis.brak) {
        return if (teraz - wpis.sprawdzono < NEGATYW_MS) DecyzjaZdjecia.NieMa else DecyzjaZdjecia.Pobierz
    }
    if (!maPlik) return DecyzjaZdjecia.Pobierz
    if (teraz - wpis.sprawdzono < SWIEZOSC_MS) return DecyzjaZdjecia.UzyjLokalnego
    return if (wpis.etag.isNotEmpty()) DecyzjaZdjecia.Rewaliduj(wpis.etag) else DecyzjaZdjecia.Pobierz
}

/**
 * Które wpisy wyrzucić, żeby zmieścić się w limitach.
 *
 * Zwraca `tw_id` w kolejności usuwania — najdawniej używane najpierw. Wpisy
 * `brak` nie zajmują miejsca na dysku, więc liczą się wyłącznie do limitu
 * SZTUK; kasowanie ich przy nadmiarze bajtów wyrzucałoby wiedzę „ta kartoteka
 * zdjęcia nie ma", czyli to, co oszczędza najwięcej żądań.
 */
fun doUsuniecia(
    wpisy: Map<Long, WpisZdjecia>,
    limitBajtow: Int,
    limitWpisow: Int,
): List<Long> {
    val doUsuniecia = mutableListOf<Long>()
    val zPlikiem = wpisy.filterValues { !it.brak }
    var bajtow = zPlikiem.values.sumOf { it.bajtow.toLong() }

    /* Do 80% limitu, nie do samej granicy: do granicy znaczyłoby, że KAŻDE
       kolejne pobranie uruchamia sprzątanie, a cache dyszy przy progu zamiast
       pracować. Ta sama reguła co po stronie serwera. */
    val celBajtow = (limitBajtow * 0.8).toLong()
    val kolejka = zPlikiem.entries.sortedBy { it.value.uzyto }
    for ((twId, wpis) in kolejka) {
        if (bajtow <= celBajtow) break
        doUsuniecia += twId
        bajtow -= wpis.bajtow.toLong()
    }

    var zostalo = wpisy.size - doUsuniecia.size
    if (zostalo > limitWpisow) {
        for ((twId, _) in wpisy.entries.sortedBy { it.value.uzyto }) {
            if (zostalo <= limitWpisow) break
            if (twId in doUsuniecia) continue
            doUsuniecia += twId
            zostalo--
        }
    }
    return doUsuniecia
}
