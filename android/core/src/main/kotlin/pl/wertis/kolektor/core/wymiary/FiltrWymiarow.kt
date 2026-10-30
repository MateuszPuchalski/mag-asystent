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
)

/** Wybór człowieka na ekranie listy. */
data class FiltrWymiarow(
    val porzadek: PorzadekWymiarow = PorzadekWymiarow.LOKALIZACJA,
    val naStanie: Boolean = false,
    /** Sprzedane w ostatnich 30 dniach. */
    val sprzedane: Boolean = false,
)

/**
 * Zapytanie o stronę. Flagi idą jako `1` albo wcale: serwer czyta brak
 * parametru jako „bez filtra", a `0` byłoby trzecim stanem do pilnowania.
 */
fun FiltrWymiarow.zapytanie(offset: Int): ZapytanieWymiarow = ZapytanieWymiarow(
    sortuj = porzadek.parametr,
    naStanie = if (naStanie) "1" else null,
    sprzedane = if (sprzedane) "1" else null,
    offset = offset,
)

/**
 * Pierwsze zapytanie po zmianie wyboru — zawsze od zera.
 * Ten sam wybór nie zaczyna listy od nowa: `null` znaczy „nic nie rób".
 */
fun zmianaFiltra(stary: FiltrWymiarow, nowy: FiltrWymiarow): ZapytanieWymiarow? =
    if (stary == nowy) null else nowy.zapytanie(0)

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
fun pustaLista(f: FiltrWymiarow): String = when {
    f.naStanie && f.sprzedane -> "Każdy towar na stanie i sprzedany w 30 dni ma wagę i wymiary."
    f.sprzedane -> "Każdy towar sprzedany w 30 dni ma wagę i wymiary."
    f.naStanie -> "Każdy towar na stanie ma wagę i wymiary."
    else -> "Każdy towar ma wagę i wymiary."
}
