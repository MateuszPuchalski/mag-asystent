package pl.wertis.kolektor.core.delivery

/* ── Kiedy faktura zakupu jest z punktu widzenia magazyniera zamknięta ────────
   Zakładka DOSTAWY liczyła to z jednego źródła: z postępu ZAPISANEGO TUTAJ
   (`linesDone` / `linesTotal`). Faktura sprawdzona w Subiekcie, ale nigdy
   nieotwarta na kolektorze, miała ten postęp zerowy — więc wyglądała identycznie
   jak nietknięta i stała na górze listy pracy.

   Rozkładanie JEST sprawdzaniem faktury, więc źródła są dwa i oba są prawdziwe:
   nasz postęp i flaga na fakturze. Reguła mieszka w `:core`, bo jest regułą,
   a nie wyglądem — a zielony build `:app` nie ma jak sprawdzić, czy dokument
   oznaczony przez biuro schodzi na dół listy.                                  */

/** Klucze stanu przysyłane przez serwer (`flagaKey`). Nazwy flag są konfigurowalne. */
object KluczFlagi {
    const val IN_PROGRESS = "in_progress"
    const val PAUSED = "paused"
    const val DONE = "done"
    const val DONE_WITH_ERRORS = "done_with_errors"
}

/**
 * Czy faktura jest sprawdzona — niezależnie od tego, kto ją sprawdził.
 *
 * `done_with_errors` też jest sprawdzone: rozbieżność ilościową ktoś już
 * zobaczył i opisał. Praca do zrobienia z niej nie wynika, więc dokument nie ma
 * czego szukać na górze listy.
 *
 * Flaga spoza tych kluczy (`null` przy niepustej nazwie) NIE zamyka dokumentu.
 * O obcej fladze firmy wiemy tylko tyle, że biuro coś nią oznaczyło.
 */
fun sprawdzona(flagaKey: String?): Boolean =
    flagaKey == KluczFlagi.DONE || flagaKey == KluczFlagi.DONE_WITH_ERRORS

/**
 * Czy wiersz dokumentu ma wyglądać na domknięty — ptaszek, wyszarzenie, dół listy.
 *
 * @param linesTotal linie robocze zapisane na kolektorze (0 = nikt tu nie otwierał)
 * @param linesDone  ile z nich domknięto
 * @param flagaKey   klucz stanu flagi faktury (`DeliveryDocument.flagaKey`)
 */
fun dokumentZamkniety(linesTotal: Int, linesDone: Int, flagaKey: String?): Boolean =
    (linesTotal > 0 && linesDone >= linesTotal) || sprawdzona(flagaKey)
