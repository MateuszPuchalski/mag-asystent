package pl.wertis.kolektor.core.wymiary

import pl.wertis.kolektor.core.net.PozycjaBezWymiarow
import pl.wertis.kolektor.core.text.formatQty

/* ── Porządek i filtry listy „Do zmierzenia" ────────────────────────────────
   Domyślny porządek to obchód regałów, bo magazynier idzie alejką. Pozostałe
   odpowiadają na pytanie właściciela „co najpierw": najczęściej sprzedawane
   i największy stan to towary, których brak wagi kosztuje najwięcej przesyłek.

   Etykiety są krótkie, bo stoją na chipach w jednym rzędzie na 360 dp.
   Pełne nazwy z panelu („Najczęściej sprzedawane (30 dni)") nie zmieściłyby
   się w celu dotyku, a lista rozwijana to dwa dotknięcia zamiast jednego.

   Zmiana porządku albo filtra zaczyna listę od zera: strona doklejona pod
   inny porządek mieszałaby dwie kolejności w jednej liście.               */

/** Porządek listy. `parametr` to wartość `sortuj` w zapytaniu do serwera. */
enum class PorzadekWymiarow(val parametr: String, val etykieta: String) {
    LOKALIZACJA("lokalizacja", "REGAŁY"),
    SPRZEDAZ("sprzedaz", "SPRZEDAŻ"),
    STAN("stan", "STAN"),
    NAJNOWSZE("najnowsze", "NOWE"),
}

/** Parametry jednego żądania strony. Flaga `null` nie jedzie wcale. */
data class ZapytanieWymiarow(
    val sortuj: String,
    val naStanie: String?,
    val sprzedane: String?,
    val offset: Int,
    /** Początek symbolu; `null` nie jedzie wcale. */
    val symbolOd: String? = null,
    /** Tylko lista pilnych biura; ta sama konwencja co flagi wyżej. */
    val pilne: String? = null,
)

/** Wybór człowieka na ekranie listy. */
data class FiltrWymiarow(
    val porzadek: PorzadekWymiarow = PorzadekWymiarow.LOKALIZACJA,
    val naStanie: Boolean = false,
    /** Sprzedane w ostatnich 30 dniach. */
    val sprzedane: Boolean = false,
    /** Początek symbolu, np. „W" — cała grupa towarów do zmierzenia naraz. */
    val symbolOd: String = "",
    /** Tylko towary z listy pilnych, którą ustala biuro. */
    val pilne: Boolean = false,
)

/**
 * Przycisk „PILNE" stoi tylko wtedy, gdy jest po co: biuro wskazało towary
 * i któryś wciąż czeka. Włączony zostaje do wyłączenia, nawet przy zerze,
 * bo inaczej znikałby spod palca razem z drogą powrotu do całej listy.
 */
fun pokazPilne(f: FiltrWymiarow, pilneRazem: Int): Boolean = f.pilne || pilneRazem > 0

/** „PILNE · 12" — liczba mówi, ile zostało, zanim człowiek w ogóle dotknie. */
fun etykietaPilnych(pilneRazem: Int): String = "PILNE · $pilneRazem"

/** Najdłuższy początek symbolu, jaki przyjmuje serwer. */
const val MAKS_ZNAKOW_SYMBOLU = 100

/**
 * Wpis człowieka → początek symbolu. Spacje z brzegów to palec, nie znak
 * symbolu. Wielkie litery, bo symbole w Subiekcie tak stoją, a serwer i tak
 * porównuje bez wielkości liter.
 */
fun poczatekSymbolu(wpis: String): String = wpis.trim().uppercase().take(MAKS_ZNAKOW_SYMBOLU)

/**
 * Zapytanie o stronę. Flagi idą jako `1` albo wcale: serwer czyta brak
 * parametru jako „bez filtra", a `0` byłoby trzecim stanem do pilnowania.
 */
fun FiltrWymiarow.zapytanie(offset: Int): ZapytanieWymiarow = ZapytanieWymiarow(
    sortuj = porzadek.parametr,
    naStanie = if (naStanie) "1" else null,
    sprzedane = if (sprzedane) "1" else null,
    offset = offset,
    symbolOd = poczatekSymbolu(symbolOd).ifEmpty { null },
    pilne = if (pilne) "1" else null,
)

/**
 * Pierwsze zapytanie po zmianie wyboru — zawsze od zera.
 * Ten sam wybór nie zaczyna listy od nowa: `null` znaczy „nic nie rób".
 */
fun zmianaFiltra(stary: FiltrWymiarow, nowy: FiltrWymiarow): ZapytanieWymiarow? {
    // porównanie po zapytaniu: „ w " i „W" to ten sam filtr, lista nie ma czego przeładować
    val z = nowy.zapytanie(0)
    return if (stary.zapytanie(0) == z) null else z
}

/**
 * Czy wpis w polu symbolu to w istocie zeskanowany kod kreskowy. Pole z
 * fokusem ucisza skaner, więc skan EAN-u wpadłby jako początek symbolu
 * i pokazał pustą listę, która kłamie. Same cyfry od 8 znaków to EAN-8,
 * EAN-13 albo ITF-14; symbole Subiektu tak nie wyglądają.
 */
fun wygladaNaKod(wpis: String): Boolean {
    val t = wpis.trim()
    return t.length in 8..14 && t.all { it in '0'..'9' }
}

/**
 * Czy wiersz ma pokazać sprzedaż i stan. Tak, gdy to one ustalają porządek
 * albo filtr — inaczej człowiek nie widzi, dlaczego towar stoi tak wysoko.
 * Przy obchodzie regałów liczby byłyby szumem obok adresu.
 */
fun FiltrWymiarow.pokazLiczby(): Boolean =
    porzadek == PorzadekWymiarow.SPRZEDAZ || porzadek == PorzadekWymiarow.STAN || naStanie || sprzedane

/** „sprzedano 12 · stan 3" — ten sam zapis co w panelu. */
fun liczbyWiersza(p: PozycjaBezWymiarow): String =
    "sprzedano ${formatQty(p.sprzedaz)} · stan ${formatQty(p.stan)}"

/**
 * Pusta lista mówi, DLACZEGO jest pusta przy tym filtrze. Gołe „brak" przy
 * włączonym filtrze wyglądałoby jak awaria albo jak koniec pracy w ogóle.
 */
fun pustaLista(f: FiltrWymiarow): String {
    val ogolnie = when {
        f.naStanie && f.sprzedane -> "Każdy towar na stanie i sprzedany w 30 dni ma wagę i wymiary."
        f.sprzedane -> "Każdy towar sprzedany w 30 dni ma wagę i wymiary."
        f.naStanie -> "Każdy towar na stanie ma wagę i wymiary."
        else -> "Każdy towar ma wagę i wymiary."
    }
    // pusta lista pilnych to koniec pracy, o którą prosiło biuro — mówi to wprost
    if (f.pilne) return "Wszystkie pilne towary mają wagę i wymiary."
    val symbol = poczatekSymbolu(f.symbolOd)
    // przy filtrze symbolu zdanie mówi o tej grupie, nie o całej kartotece
    return if (symbol.isEmpty()) ogolnie else "Symbole na „$symbol”: " + ogolnie.replaceFirstChar { it.lowercase() }
}
