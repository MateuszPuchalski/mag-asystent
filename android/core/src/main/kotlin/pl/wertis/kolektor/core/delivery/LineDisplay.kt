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
     * Zrobione — cienki pasek z przekreśleniem, na swoim miejscu w liście.
     *
     * Zwężanie, a NIE ukrywanie ani przenoszenie na dół: karton drobnicy to
     * dziesięć pozycji, które mają się zmieścić na jednym ekranie, ale lista
     * jest kontrolą kompletności — trzeba móc wzrokiem sprawdzić, co już
     * poszło i gdzie. Przenoszenie na dół sprawiałoby, że wiersze skaczą po
     * każdym odłożeniu.
     */
    ZWINIETY,

    /** Trwa odkładanie tej pozycji — panel z lokalizacją i ilością pod wierszem. */
    ROZWINIETY,

    /** Wyjątek (D8) — nie zwija się nigdy, bo wypadł z rutyny i wymaga decyzji. */
    PROBLEM,
}

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

/** Czy pozycja jest domknięta — do licznika „zostało" i do wyglądu ikony. */
fun zamknieta(status: String): Boolean =
    status == StatusLinii.DONE || status == StatusLinii.SKIPPED || status == StatusLinii.PROBLEM
