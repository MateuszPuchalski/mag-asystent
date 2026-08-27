package pl.wertis.kolektor.core.delivery

/* ── Jak ma wyglądać wiersz pozycji na liście rozkładania ───────────────────
   Reguła mieszka poza Androidem, bo ma jedną pułapkę, której zielony build
   `:app` nie wyłapie: pozycja ODŁOŻONA i jednocześnie ROZWINIĘTA. Zdarza się
   realnie — magazynier odkłada resztę partii do drugiej lokalizacji albo wraca
   do pozycji, żeby zgłosić uszkodzenie po fakcie. Gdyby zwijanie wygrywało
   z rozwinięciem, wiersz zniknąłby dokładnie w chwili, w której człowiek na
   niego patrzy.

   Kolejność rozstrzygania jest więc odwrotna do intuicyjnej: najpierw
   rozwinięcie, dopiero potem status.                                          */

/** Status linii z serwera (`DeliveryLineView.status`). */
object StatusLinii {
    const val TODO = "todo"
    const val PARTIAL = "partial"
    const val DONE = "done"
    const val SKIPPED = "skipped"
    const val PROBLEM = "problem"
}

enum class TrybWiersza {
    /** Do zrobienia — pełny wiersz z lokalizacją docelową. */
    ZWYKLY,

    /**
     * Zrobione — cienki pasek z przekreśleniem, zepchnięty na DÓŁ listy.
     *
     * Zwężanie, a nie ukrywanie: lista jest kontrolą kompletności, więc trzeba
     * móc wzrokiem sprawdzić, co już poszło i gdzie. Ale od 0.35.0 zwinięte
     * pozycje schodzą na koniec — powód i cena tej zmiany stoją przy
     * `uporzadkujPozycje`.
     */
    ZWINIETY,

    /** Trwa odkładanie tej pozycji — panel z lokalizacją i ilością pod wierszem. */
    ROZWINIETY,

    /** Wyjątek (D8) — nie zwija się nigdy, bo wypadł z rutyny i wymaga decyzji. */
    PROBLEM,
}

/**
 * Adres pokazywany na wierszu pozycji — FAKTYCZNY wygrywa z oczekiwanym.
 *
 * To są dwa różne pola i mylenie ich kosztowało błąd widoczny w hali: pozycja
 * bez adresu, odłożona i opatrzona adresem, dalej pokazywała „BRAK".
 *
 * `locExpected` mówi „gdzie to ma trafić" i od 0.36.1 dla pozycji NIETKNIĘTEJ
 * jest wartością żywą — serwer liczy ją z kartoteki skorygowanej o kolejkę
 * zapisów, bo zamrożona wysyłała ludzi do regału, z którego towar dawno zjechał
 * (ten sam towar na dwóch dostawach). Pozycja, na której ktoś już pracował,
 * zachowuje swoją wartość z chwili pracy — i na NIEJ stoi wykrywanie rozjazdu.
 * `locActual` mówi, gdzie towar NAPRAWDĘ wylądował, i tylko to interesuje
 * człowieka patrzącego na zamkniętą pozycję.
 *
 * `null` znaczy „jeszcze nigdzie" — i dopiero to zasługuje na „BRAK".
 */
fun adresWiersza(locExpected: String?, locActual: String?): String? = locActual ?: locExpected

/* ── Kolejność pozycji na liście rozkładania ────────────────────────────────
   ODWRACAMY tu wcześniejszą decyzję i warto powiedzieć, czym za nią płacimy.
   Do 0.35.0 odłożone pozycje zostawały na swoim miejscu, tylko zwężone —
   z obawy, że przenoszenie ich na dół każe wierszom skakać po każdym zapisie.
   Praktyka pokazała drugą stronę: dziesięć zwiniętych pasków dalej zajmuje
   ekran, więc przy większym kartonie do pozycji „do zrobienia" trzeba się
   PRZEWIJAĆ przez robotę już wykonaną.

   Skok kosztuje mniej, niż zakładano, bo następną pozycję bierze się SKANEM,
   a skan trafia w towar po symbolu, nie w miejsce na ekranie. Dotknięcie jest
   ścieżką awaryjną i to ono płaci za tę zmianę.

   Dwa zabezpieczenia zostają:
   - POZYCJA Z PROBLEMEM NIE SCHODZI NA DÓŁ, choć jest „załatwiona" w sensie
     licznika. Wyjątek wypadł z rutyny i czeka na decyzję (D8); zepchnięcie go
     pod zrobione byłoby schowaniem go dokładnie tak, jak zabrania tego reguła
     „wyjątek nie zwija się nigdy".
   - Pozycje BEZ LOKALIZACJI zostają osobną grupą tuż nad zrobionymi — to nie
     rutyna, tylko SKU wymagające decyzji.                                     */

/** Kubełek pozycji: im niżej, tym dalej od uwagi człowieka. */
private fun kubelekPozycji(status: String, locExpected: String?): Int = when {
    trybWiersza(status, aktywna = false) == TrybWiersza.ZWINIETY -> 2
    locExpected == null -> 1
    else -> 0
}

/**
 * Do zrobienia na górze, bez lokalizacji pośrodku, odłożone na dole.
 *
 * Wewnątrz dwóch pierwszych kubełków zostaje kolejność z serwera
 * (alfabetycznie po adresie, czyli po alejkach), więc trasa przez halę się
 * nie zmienia.
 *
 * ZROBIONE UKŁADAJĄ SIĘ OD NAJNOWSZYCH (0.113.0). Kolejność alejkowa nie
 * znaczyła tam nic — po odłożeniu nikt nie idzie do tych półek drugi raz —
 * a jedno pytanie do tej grupy pada naprawdę: „czy ostatnia poszła tam, gdzie
 * miała". Odpowiedź stoi teraz w pierwszym wierszu pod pracą do zrobienia,
 * zamiast gdzieś w środku listy. Pozycja bez znacznika czasu (starszy serwer,
 * pominięcie bez odłożenia) siada za nimi, w kolejności z serwera.
 *
 * @param status funkcja wyciągająca status pozycji
 * @param locExpected funkcja wyciągająca adres oczekiwany
 * @param doneAt znacznik odłożenia (ISO); domyślnie brak — wtedy nic nie zmienia
 */
fun <T> uporzadkujPozycje(
    pozycje: List<T>,
    status: (T) -> String,
    locExpected: (T) -> String?,
    doneAt: (T) -> String? = { null },
): List<T> {
    // `groupBy` zachowuje kolejność wejściową wewnątrz grup — na tym stoją
    // dwa pierwsze kubełki i dlatego nie ma tu jednego `sortedBy`
    val kubelki = pozycje.groupBy { kubelekPozycji(status(it), locExpected(it)) }
    return kubelki[0].orEmpty() + kubelki[1].orEmpty() + odNajnowszych(kubelki[2].orEmpty(), doneAt)
}

/** Zrobione od ostatnio odłożonej; bez znacznika czasu — na końcu, bez zmian. */
private fun <T> odNajnowszych(zrobione: List<T>, doneAt: (T) -> String?): List<T> =
    zrobione.sortedWith(
        compareBy<T> { doneAt(it) == null }.thenByDescending { doneAt(it) ?: "" }
    )

/** Czy pozycja czeka jeszcze na decyzję „gdzie to położyć". */
fun <T> czekaBezLokalizacji(
    pozycje: List<T>,
    status: (T) -> String,
    locExpected: (T) -> String?,
): List<T> = pozycje.filter { kubelekPozycji(status(it), locExpected(it)) == 1 }

/**
 * @param status wartość `DeliveryLineView.status`
 * @param aktywna czy to jest linia czekająca na skan lokalizacji
 */
fun trybWiersza(status: String, aktywna: Boolean): TrybWiersza = when {
    aktywna -> TrybWiersza.ROZWINIETY
    status == StatusLinii.PROBLEM -> TrybWiersza.PROBLEM
    status == StatusLinii.DONE || status == StatusLinii.SKIPPED -> TrybWiersza.ZWINIETY
    else -> TrybWiersza.ZWYKLY
}
