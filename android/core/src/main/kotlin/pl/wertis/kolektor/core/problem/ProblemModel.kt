package pl.wertis.kolektor.core.problem

/* ── Niezgodność w dostawie (redesign §4.6, D8) ──────────────────────────────
   Od 0.21.0 lista kategorii to DOSŁOWNIE lista z firmowego formularza
   „Niezgodność w dostawie". Wcześniej kolektor zbierał własny zestaw siedmiu
   typów, a różnicę między nim a formularzem uzupełniało biuro z pamięci.

   Typy są ZAMKNIĘTE. Otwarte pole „opisz problem" daje dane, których nikt nie
   policzy; zamknięta lista daje wiersz, który da się przepisać dostawcy.

   Reguły „co jest wymagane" żyją tutaj (SDK-free, testowalne) i są lustrem
   walidacji serwera — kolektor nie wysyła zgłoszenia, o którym z góry wiadomo,
   że serwer je odrzuci; magazynier ma dostać komunikat od razu, w alejce.

   Od 0.57.0 każdy typ zna też swój ZAKRES. Do tej pory arkusz rysował wszystkie
   pięć kategorii niezależnie od tego, czy zgłasza się pozycję, czy dostawę —
   i wychodziło to bokiem w obie strony. Na pozycji stał „Artykuł niezamówiony",
   czyli z definicji towar SPOZA dokumentu, po którego wybraniu arkusz żądał
   ręcznego numeru katalogowego mimo widocznego symbolu wybranej pozycji.
   A przy zgłoszeniu dostawy stała „Zła ilość" — kafel MARTWY, bo serwer
   odmawiał go od zawsze.                                                      */

/** Czy kategoria opisuje JEDNĄ pozycję dokumentu, czy całą dostawę. */
enum class ZakresProblemu { POZYCJA, DOSTAWA }

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
    /**
     * Gdzie ta kategoria ma sens. `DOSTAWA` znaczy „nie ma pozycji, do której
     * dałoby się to przypiąć" — nie „można i tak, i tak".
     */
    val zakres: ZakresProblemu = ZakresProblemu.POZYCJA,
) {
    /* KOLEJNOŚĆ JEST TREŚCIĄ, nie porządkiem alfabetycznym. „Zła ilość" stoi
       pierwsza, bo rozbieżność ilościowa to najczęstszy wyjątek — i bo w 0.57.0
       zniknął skrót „INNA ILOŚĆ", który dawał jej własny przycisk w panelu
       odkładania. Przesunięcie jej dalej cofa tamtą zmianę bez zapowiedzi. */
    QTY_MISMATCH("qty_mismatch", "Zła ilość"),
    MISSING_ITEM("missing_item", "Brak w przesyłce"),
    DAMAGED("damaged", "Uszkodzone w transporcie", photoRequired = true),
    WRONG_ITEM("wrong_item", "Błędny artykuł", photoRequired = true, symObcyRequired = true),
    EXTRA_ITEM(
        "extra_item",
        "Artykuł niezamówiony",
        symObcyRequired = true,
        zakres = ZakresProblemu.DOSTAWA,
    );

    companion object {
        /**
         * Kategorie do pokazania, zależnie od tego, co zgłaszamy.
         *
         * Kolejność zachowana z deklaracji enuma — patrz komentarz wyżej.
         * Dla dostawy zostaje dziś dokładnie jedna kategoria i to jest wynik
         * świadomej decyzji: uszkodzenie ma być przypięte do pozycji, żeby
         * protokół dla dostawcy wiedział, CZEGO dotyczy.
         */
        fun dozwolone(dlaPozycji: Boolean): List<ProblemType> {
            val szukany = if (dlaPozycji) ZakresProblemu.POZYCJA else ZakresProblemu.DOSTAWA
            return entries.filter { it.zakres == szukany }
        }

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
    /* Zakres w OBIE strony. Do 0.57.0 stała tu tylko połowa tej reguły i tylko
       dla „złej ilości" — więc „artykuł niezamówiony" dawało się przypiąć do
       pozycji faktury, z którą nie miał nic wspólnego, i ustawić jej status
       „problem". */
    type.zakres == ZakresProblemu.POZYCJA && lineId == null ->
        "„${type.label}” dotyczy pozycji z dokumentu — wybierz ją z listy"
    type.zakres == ZakresProblemu.DOSTAWA && lineId != null ->
        "„${type.label}” dotyczy całej dostawy — zgłoś to przyciskiem pod listą"
    type == ProblemType.DAMAGED && nrPrzesylki.isNullOrBlank() -> "Podaj numer przesyłki"
    else -> null
}
