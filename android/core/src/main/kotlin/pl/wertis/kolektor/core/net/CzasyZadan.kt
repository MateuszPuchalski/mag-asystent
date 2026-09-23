package pl.wertis.kolektor.core.net

import kotlinx.serialization.Serializable

/* ── Czas odpowiedzi KAŻDEGO żądania, per ekran i trasa ─────────────────────
   Do tego wydania czas mierzyła wyłącznie wspólna droga skanu, a woła ją
   tylko ekran główny. Rozkładanie dostaw, koszy i kartonów — czyli większość
   zmiany — nie miało pomiaru wcale, a „p95 hali" w panelu mówiło o jednej
   czynności.

   Pomiar stoi teraz w kliencie HTTP i obejmuje każde żądanie. Mierzy sieć
   i serwer, bez rysowania ekranu — to jest dokładnie ta część, którą psuje
   Wi-Fi przy metalowych regałach.

   KUBEŁKI, NIE SUROWE CZASY. Kolektor wysyła co kilka minut jedno zdarzenie
   z liczbą odpowiedzi w każdym przedziale. Przedziały da się sumować po
   stronie serwera między paczkami i kolektorami; percentyli z paczek już nie.
   Granice 150 i 300 ms to cel planu i próg, od którego ludzie skanują dwa
   razy — raport liczy udział powyżej 300 ms wprost z kubełków.

   Granice stoją także w `server/src/services/ergonomia.ts` (`KUBELKI_MS`)
   i test serwera sprawdza, że obie listy są równe. */

/** Górne granice przedziałów w ms; ostatni kubełek to „powyżej 1000". */
val KUBELKI_MS: List<Long> = listOf(100, 150, 300, 600, 1000)

@Serializable
data class WierszCzasow(
    val ekran: String,
    val trasa: String,
    val n: Int,
    /** Liczba odpowiedzi w przedziałach `KUBELKI_MS` + jeden ponad ostatnią granicą. */
    val kubelki: List<Int>,
)

/**
 * Trasa bez identyfikatorów i bez zapytania — ta sama reguła co `wzorTrasy`
 * na serwerze. `/api/delivery/12/lines/34/cofnij?x=1` →
 * `/api/delivery/:x/lines/:x/cofnij`. Bez tego każda dostawa byłaby osobnym
 * wierszem, a paczka rosłaby z każdą otwartą kartą towaru.
 */
fun wzorTrasy(sciezka: String): String =
    sciezka.substringBefore('?').split('/').joinToString("/") { c -> if (c.any { it.isDigit() }) ":x" else c }

/**
 * Czy to żądanie w ogóle mierzymy.
 *
 * Poza pomiarem zostają trzy rodzaje, bo żaden nie jest czekaniem człowieka:
 * sama telemetria (mierzyłaby siebie), pytanie o wezwanie zgubionego
 * kolektora (tło co 10 s zdominowałoby liczby każdego ekranu) i pobranie
 * pliku, które trwa sekundy z natury, a nie z powodu sieci.
 */
fun mierzyc(sciezka: String): Boolean =
    sciezka.startsWith("/api/") &&
        sciezka != "/api/device/event" &&
        sciezka != "/api/kolektor/wezwanie" &&
        !dlugiePobranie(sciezka)

/** Numer przedziału dla czasu `ms`. */
fun kubelek(ms: Long): Int = KUBELKI_MS.indexOfFirst { ms <= it }.let { if (it < 0) KUBELKI_MS.size else it }

/**
 * Licznik między wysyłkami. Bezpieczny wątkowo, bo OkHttp woła interceptor
 * z własnej puli wątków, a zrzut idzie z korutyny aplikacji.
 */
class LicznikCzasow {
    private val wiersze = HashMap<Pair<String, String>, IntArray>()

    @Synchronized
    fun zapisz(ekran: String, sciezka: String, ms: Long) {
        val k = ekran to wzorTrasy(sciezka)
        val t = wiersze.getOrPut(k) { IntArray(KUBELKI_MS.size + 1) }
        t[kubelek(ms)]++
    }

    /** Zabiera zebrane wiersze i zeruje licznik; pusta lista = nic do wysłania. */
    @Synchronized
    fun zrzut(): List<WierszCzasow> {
        val wynik = wiersze.map { (k, t) -> WierszCzasow(k.first, k.second, t.sum(), t.toList()) }
            .sortedWith(compareBy({ it.ekran }, { it.trasa }))
        wiersze.clear()
        return wynik
    }

    /**
     * Oddaje wiersze, których wysyłka się nie udała. Pomiar z martwej strefy
     * Wi-Fi jest najcenniejszy ze wszystkich — zgubienie go przy pierwszej
     * nieudanej wysyłce wycięłoby z raportu dokładnie te miejsca, o które
     * raport pyta.
     */
    @Synchronized
    fun oddaj(zwrot: List<WierszCzasow>) {
        for (w in zwrot) {
            val t = wiersze.getOrPut(w.ekran to w.trasa) { IntArray(KUBELKI_MS.size + 1) }
            w.kubelki.forEachIndexed { i, n -> if (i < t.size) t[i] += n }
        }
    }
}
