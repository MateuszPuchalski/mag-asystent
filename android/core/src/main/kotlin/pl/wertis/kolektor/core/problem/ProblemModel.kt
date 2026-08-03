package pl.wertis.kolektor.core.problem

/* ── Niezgodność w dostawie (redesign §4.6, D8) ──────────────────────────────
   Od 0.21.0 lista kategorii to DOSŁOWNIE lista z firmowego formularza
   „Niezgodność w dostawie". Wcześniej kolektor zbierał własny zestaw siedmiu
   typów, a różnicę między nim a formularzem uzupełniało biuro z pamięci.

   Typy są ZAMKNIĘTE. Otwarte pole „opisz problem" daje dane, których nikt nie
   policzy; zamknięta lista daje wiersz, który da się przepisać dostawcy.

   Reguły „co jest wymagane" żyją tutaj (SDK-free, testowalne) i są lustrem
   walidacji serwera — kolektor nie wysyła zgłoszenia, o którym z góry wiadomo,
   że serwer je odrzuci; magazynier ma dostać komunikat od razu, w alejce.     */

enum class ProblemType(
    /** Klucz protokołu — musi się zgadzać z PROBLEM_TYPES na serwerze. */
    val key: String,
    val label: String,
    /** Zdjęcie obowiązkowe: bez dowodu to opinia, a nie zgłoszenie. */
    val photoRequired: Boolean = false,
    /**
     * Numer katalogowy trzeba WPISAĆ, bo artykuł nie jest na dokumencie i nie
     * ma linii, z której dałoby się go odczytać.
     */
    val symObcyRequired: Boolean = false,
) {
    WRONG_ITEM("wrong_item", "Błędny artykuł", photoRequired = true, symObcyRequired = true),
    MISSING_ITEM("missing_item", "Brak w przesyłce"),
    DAMAGED("damaged", "Uszkodzone w transporcie", photoRequired = true),
    QTY_MISMATCH("qty_mismatch", "Zła ilość"),
    EXTRA_ITEM("extra_item", "Artykuł niezamówiony", symObcyRequired = true);

    companion object {
        /**
         * Etykieta do listy wyjątków. Zna też klucze sprzed 0.21.0, bo stare
         * zgłoszenia zostają w bazie na zawsze — historii się nie kasuje —
         * a lista nierozwiązanych pokazywałaby wtedy surowe `qty_short`.
         */
        fun labelOf(key: String): String =
            entries.firstOrNull { it.key == key }?.label ?: HISTORYCZNE[key] ?: key

        /** Wyjątki sprzed 0.21.0: do nazwania, nie do zgłoszenia. */
        private val HISTORYCZNE = mapOf(
            "qty_short" to "Za mało",
            "qty_over" to "Za dużo",
            "no_space" to "Brak miejsca",
            "unknown_barcode" to "Nieznany kod",
            "ean_conflict" to "Kolizja EAN",
        )
    }
}

/**
 * Czego brakuje, żeby zgłoszenie było kompletne — `null` znaczy „można wysłać".
 * Zwracamy komunikat, a nie boolean, bo przycisk musi umieć powiedzieć DLACZEGO
 * jest zablokowany.
 *
 * `nrPrzesylki` dotyczy tylko uszkodzenia w transporcie i CAŁEJ przesyłki:
 * jeśli dostawa ma już zapisany numer, ekran nie pyta o niego drugi raz i
 * podaje tutaj to, co zapisano. Serwer przyjmuje numer osobną trasą i nie
 * wymaga go przy zgłoszeniu — to kolektor pilnuje, żeby pytanie padło przy
 * palecie, a nie tydzień później w biurze.
 */
fun problemBlocker(
    type: ProblemType,
    qty: Double?,
    hasPhoto: Boolean,
    symObcy: String? = null,
    nrPrzesylki: String? = null,
    lineId: Long? = null,
): String? = when {
    type.photoRequired && !hasPhoto -> "Zrób zdjęcie — to dowód do reklamacji"
    // ilość jest wymagana w KAŻDEJ kategorii — formularz żąda jej wszędzie
    qty == null || qty < 0 -> "Podaj ilość"
    type.symObcyRequired && symObcy.isNullOrBlank() -> "Podaj numer katalogowy tego artykułu"
    // „zła ilość" mówi o pozycji Z DOKUMENTU — bez niej nie ma z czym porównać
    type == ProblemType.QTY_MISMATCH && lineId == null -> "Zła ilość dotyczy pozycji z dokumentu"
    type == ProblemType.DAMAGED && nrPrzesylki.isNullOrBlank() -> "Podaj numer przesyłki"
    else -> null
}
