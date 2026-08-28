package pl.wertis.kolektor.core.karton

/* ── KARTON: rozkładanie od zera (0.122.0) ───────────────────────────────────
   Karton to pudło, do którego pakujący odkładają towary źle zebrane pod
   zamówienia. W bazie jest koszem — rozkładanie obu jest tą samą pracą — więc
   ekran rozkładania jest wspólny. Osobna jest FAZA WCZEŚNIEJSZA: zawartość
   kartonu nikt nie zna z dokumentu, bo dokumentu nie ma. Ktoś ją zbiera
   ręką przy pudle.

   Tu leży to, co z tej fazy da się rozstrzygnąć bez ekranu.                   */

/** Wartość kolumny `rodzaj` odróżniająca karton od kosza zwrotowego. */
const val RODZAJ_KARTON = "karton"

/**
 * Co ekran ma pokazać. Wynika ze STATUSU kosza, a nie z osobnego przełącznika:
 * dwa źródła prawdy o tym samym rozjeżdżają się przy pierwszym błędzie sieci,
 * a wtedy człowiek zbiera do pudła, które serwer uważa za zatwierdzone.
 */
enum class FazaKartonu {
    /** `otwarty` — dokładamy towar skanem albo symbolem. */
    ZBIORKA,

    /** `zamkniety` — lista jest kompletna, teraz idzie na półki. */
    ROZKLADANIE,

    /** `rozlozony` — nie ma tu już nic do zrobienia. */
    ZROBIONE,
}

fun fazaKartonu(status: String): FazaKartonu = when (status) {
    "otwarty" -> FazaKartonu.ZBIORKA
    "rozlozony" -> FazaKartonu.ZROBIONE
    else -> FazaKartonu.ROZKLADANIE
}

/**
 * Kolejność listy przy ZBIERANIU: od NAJNOWSZEJ pozycji.
 *
 * Odwrotnie niż przy rozkładaniu, i to nie jest niekonsekwencja — to inne
 * pytanie. Rozkładanie układa listę trasą alejek, bo prowadzi człowieka po
 * magazynie. Zbieranie odpowiada na jedno: „czy to, co przed chwilą
 * zeskanowałem, weszło i w jakiej ilości". Odpowiedź musi być widoczna bez
 * przewijania, a przy pudle na trzydzieści pozycji nowa wpadałaby na koniec.
 *
 * Klucz to identyfikator pozycji, bo rośnie z każdym wstawieniem. Skan towaru,
 * który już w pudle jest, PODNOSI ilość istniejącej pozycji i ta zostaje tam,
 * gdzie była — dosypywanie tego samego nie jest nowym zdarzeniem.
 */
fun <T> kolejnoscZbierania(pozycje: List<T>, id: (T) -> Long): List<T> =
    pozycje.sortedByDescending(id)

/**
 * Podpis wiersza na liście kartonów — stan PRACY, nie stan rekordu.
 *
 * „otwarty" i „zamknięty" to słowa bazy danych; przy pudle pyta się o co
 * innego: czy jeszcze się do niego dokłada, czy już się je rozkłada.
 */
fun podpisKartonu(status: String, pozycji: Int, odlozonych: Int): String =
    when (fazaKartonu(status)) {
        FazaKartonu.ZBIORKA ->
            if (pozycji == 0) "w zbiórce · pusty" else "w zbiórce · $pozycji poz."
        FazaKartonu.ROZKLADANIE -> "do rozłożenia · $odlozonych/$pozycji poz."
        FazaKartonu.ZROBIONE -> "rozłożony"
    }
