package pl.wertis.kolektor.core.problem

/* ── Wyjątki przy rozkładaniu dostawy (redesign §4.6, D8) ────────────────────
   Typy są ZAMKNIĘTE. Otwarte pole „opisz problem" daje dane, których nikt nie
   policzy; zamknięta lista daje raport, który da się pokazać dostawcy.

   Reguły „co jest wymagane" żyją tutaj (SDK-free, testowalne) i są lustrem
   walidacji serwera — kolektor nie wysyła zgłoszenia, o którym z góry wiadomo,
   że serwer je odrzuci; magazynier ma dostać komunikat od razu, w alejce.     */

enum class ProblemType(
    /** Klucz protokołu — musi się zgadzać z PROBLEM_TYPES na serwerze. */
    val key: String,
    val label: String,
    /** Zdjęcie obowiązkowe: bez dowodu to opinia, a nie zgłoszenie. */
    val photoRequired: Boolean = false,
    /** Ilość faktyczna obowiązkowa. */
    val qtyRequired: Boolean = false,
) {
    QTY_SHORT("qty_short", "Za mało", qtyRequired = true),
    QTY_OVER("qty_over", "Za dużo", qtyRequired = true),
    DAMAGED("damaged", "Uszkodzony", photoRequired = true),
    WRONG_ITEM("wrong_item", "Zły towar", photoRequired = true),
    NO_SPACE("no_space", "Brak miejsca"),
    UNKNOWN_BARCODE("unknown_barcode", "Nieznany kod", photoRequired = true),
    EAN_CONFLICT("ean_conflict", "Kolizja EAN");

    companion object {
        /** Etykieta do listy wyjątków; nieznany klucz pokazujemy surowo. */
        fun labelOf(key: String): String = entries.firstOrNull { it.key == key }?.label ?: key
    }
}

/**
 * Czego brakuje, żeby zgłoszenie było kompletne — `null` znaczy „można wysłać".
 * Zwracamy komunikat, a nie boolean, bo przycisk musi umieć powiedzieć DLACZEGO
 * jest zablokowany.
 */
fun problemBlocker(type: ProblemType, qty: Double?, hasPhoto: Boolean): String? = when {
    type.photoRequired && !hasPhoto -> "Zrób zdjęcie — to dowód do reklamacji"
    type.qtyRequired && (qty == null || qty < 0) -> "Podaj ilość faktyczną"
    else -> null
}
