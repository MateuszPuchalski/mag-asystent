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

    /**
     * `anulowany` — pudło odwołane (0.123.0). Osobno od ZROBIONE, bo to jest
     * przeciwieństwo zrobionego: praca się NIE wydarzyła i ekran nie ma prawa
     * sugerować, że wszystko poszło na półki.
     */
    ANULOWANY,
}

fun fazaKartonu(status: String): FazaKartonu = when (status) {
    "otwarty" -> FazaKartonu.ZBIORKA
    "rozlozony" -> FazaKartonu.ZROBIONE
    "anulowany" -> FazaKartonu.ANULOWANY
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
 * Polska liczba mnoga dla „półka". Prywatne i celowo: repo nie odmienia
 * NICZEGO — wszędzie stoją formy nieodmienne (`poz.`, `szt.`, `zwr.`) — więc
 * pierwszy przypadek nie ma komu służyć poza tym jednym podpisem. Abstrakcja
 * powstanie, gdy zgłosi się drugi wołający (wzorzec `Szukanie.kt`).
 *
 * Reguła jest nieoczywista w obie strony: 12–14 idzie na „półek" MIMO
 * końcówki 2–4, a 22–24 wraca na „półki". Dlatego ma test.
 */
private fun polki(n: Int): String {
    if (n == 1) return "półka"
    val dziesiatki = n % 100
    val jednosci = n % 10
    return if (jednosci in 2..4 && dziesiatki !in 12..14) "półki" else "półek"
}

/**
 * Gdzie ten towar wraca — jedną linią, pod nazwą (0.124.0).
 *
 * ZASTĘPUJE RZĄD CHIPÓW i to jest cała ta zmiana. `LocChip` ma
 * `heightIn(min = 44.dp)`, bo 44 dp to minimalny cel dla palca — a w zbiórce
 * te chipy były NIEKLIKALNE: odkładanie zaczyna się dopiero po ZATWIERDŹ.
 * Karta płaciła 52 dp (44 % swojej wysokości) rozmiarem kciuka za coś, czego
 * żaden kciuk nie dotyka. Ze zgłoszenia: „pozycja zajmuje za dużo miejsca".
 *
 * Adres pickingowy zostaje PEŁNYM kodem, bo to on jest odpowiedzią na pytanie
 * „dokąd to wróci". Reszta półek schodzi do licznika — przy zbieraniu wystarczy
 * wiedzieć, że są; wypisane w całości zabierały linię, którą zabrały.
 */
fun podpisPolek(lokOczekiwana: String?, lokalizacje: List<String>): String {
    /* Pickingowy z pola, a gdy go nie ma — pierwszy z listy. `szczegolKosza`
       zawsze wypełnia `lokOczekiwana`, kiedy towar ma jakikolwiek adres, więc
       ta gałąź jest teoretyczna; pominięcie adresu, który JEST, byłoby jednak
       gorsze niż jedna linijka zapasu. */
    val glowna = lokOczekiwana?.takeIf { it.isNotBlank() } ?: lokalizacje.firstOrNull()
    if (glowna == null) return "bez adresu w kartotece"
    val innych = lokalizacje.count { it != glowna }
    return if (innych == 0) glowna else "$glowna · +$innych ${polki(innych)}"
}

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
        FazaKartonu.ANULOWANY -> "anulowany · $pozycji poz."
    }
