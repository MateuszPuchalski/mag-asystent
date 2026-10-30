package pl.wertis.kolektor.core.net

import kotlinx.serialization.Serializable

/* ── DTO wag i wymiarów — lustro `panel/src/api/wymiary.ts` i tras serwera ──
   Wagi przychodzą jako liczby w kilogramach, wymiary jako SUROWY tekst z pól
   własnych Subiekta („21,5"). Kolektor ich nie przelicza: pokazuje to, co
   stoi w kartotece, a nowy pomiar wysyła tekstem, jak wpisał człowiek.
   Serwer zamienia go na liczbę i jest ostatnią instancją walidacji.          */

/** Wiersz listy „Do zmierzenia". */
@Serializable
data class PozycjaBezWymiarow(
    val twId: Long,
    val symbol: String,
    val nazwa: String = "",
    val ean: String? = null,
    val stan: Double = 0.0,
    /** Sztuki sprzedane w ostatnich 30 dniach. */
    val sprzedaz: Double = 0.0,
    /** Adresy półek rozdzielone spacją; `null` = brak. */
    val lokalizacja: String? = null,
    val brutto: Double? = null,
    val netto: Double? = null,
    val dlugosc: String? = null,
    val szerokosc: String? = null,
    val wysokosc: String? = null,
    /** Pomiar już czeka w kolejce do Subiekta — drugi byłby zgadywaniem. */
    val oczekuje: Boolean = false,
)

/**
 * Strona listy. `wlaczone = false` znaczy, że serwer nie ma skąd czytać albo
 * gdzie pisać wymiarów; wtedy ekran pokazuje `powod`, a nie pustą listę.
 * Brak pola to także „wyłączone": starszy serwer tej trasy nie zna.
 */
@Serializable
data class ListaBezWymiarow(
    val wlaczone: Boolean = false,
    val powod: String? = null,
    val razem: Int = 0,
    val pozycje: List<PozycjaBezWymiarow> = emptyList(),
)

/** Kartoteka do formularza pomiaru — to, co Subiekt dziś o niej wie. */
@Serializable
data class TowarDoPomiaru(
    val twId: Long,
    val symbol: String,
    val nazwa: String = "",
    val ean: String? = null,
    val lokalizacja: String? = null,
    val brutto: Double? = null,
    val netto: Double? = null,
    val dlugosc: String? = null,
    val szerokosc: String? = null,
    val wysokosc: String? = null,
)

/** Odpowiedź `GET api/wymiary/{twId}`. `towar = null` tylko przy wyłączonej funkcji. */
@Serializable
data class WymiaryTowaru(
    val wlaczone: Boolean = false,
    val powod: String? = null,
    val towar: TowarDoPomiaru? = null,
    val oczekuje: Boolean = false,
)

/**
 * Ciało zapisu pomiaru. Pole `null` NIE jedzie w ogóle (`explicitNulls = false`
 * w `WertisJson`), a serwer czyta brak klucza jako „zostaw w Subiekcie".
 */
@Serializable
data class PomiarBody(
    val bruttoKg: String? = null,
    val nettoKg: String? = null,
    val dlugosc: String? = null,
    val szerokosc: String? = null,
    val wysokosc: String? = null,
)

/** Odpowiedź zapisu. Echo pomiaru serwera pomijamy — kolektor go nie rysuje. */
@Serializable
data class ZapisPomiaruResponse(val queueId: Long = 0)
