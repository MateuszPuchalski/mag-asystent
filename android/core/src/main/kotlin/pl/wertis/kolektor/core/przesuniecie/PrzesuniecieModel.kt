package pl.wertis.kolektor.core.przesuniecie

/* ── Przesunięcie stanu między magazynami (0.22.0) ───────────────────────────
   Zastąpiło sesję z wózkiem: zamiast rundy po kontenerze jest jedna czynność —
   przesuń tyle a tyle sztuk z magazynu do magazynu.

   Reguły „czego brakuje" żyją tutaj (SDK-free, testowalne) i są lustrem
   walidacji serwera. Kolektor nie wysyła żądania, o którym z góry wiadomo, że
   serwer je odrzuci; magazynier ma dostać komunikat od razu, w alejce.        */

/**
 * Czego brakuje, żeby przesunięcie było kompletne — `null` znaczy „można
 * wysłać". Zwracamy komunikat, a nie boolean, bo przycisk musi umieć
 * powiedzieć DLACZEGO jest zablokowany.
 *
 * @param magMag identyfikator hali; przy nim i tylko przy nim adres ma sens
 * @param dostepne stan źródła pomniejszony o przesunięcia już w kolejce
 */
fun przesuniecieBlocker(
    magFrom: Long?,
    magTo: Long?,
    qty: Double?,
    dostepne: Double,
    location: String?,
    magMag: Long,
): String? = when {
    magFrom == null -> "Wybierz magazyn źródłowy"
    magTo == null -> "Wybierz magazyn docelowy"
    magFrom == magTo -> "Wybierz inny magazyn docelowy"
    qty == null || qty <= 0 -> "Podaj ilość"
    /* Stan pokazujemy w komunikacie, bo sama odmowa nie mówi, ile wolno.
       Liczba jest już pomniejszona o to, co czeka w kolejce — kolejka jest
       zarazem rezerwacją. */
    qty > dostepne -> "Dostępne tylko ${formatujStan(dostepne)}"
    /* Adres w kartotece Subiekta to JEDNO pole na towar, bez wymiaru magazynu:
       opisuje regał na hali. Przy celu MAG skan jest jedynym dowodem, że towar
       trafił tam, gdzie system myśli; przy innym celu nie ma czego zeskanować,
       a zapisany kod nadpisałby adres hali adresem, którego na hali nie ma. */
    magTo == magMag && location.isNullOrBlank() -> "Zeskanuj półkę, na którą kładziesz towar"
    else -> null
}

/** Czy przy tym celu w ogóle pytamy o półkę. Ekran chowa wtedy całą strefę skanu. */
fun pytamyOPolke(magTo: Long?, magMag: Long): Boolean = magTo == magMag

/** Liczba bez zbędnego „.0" — ta sama zasada co w `core/text/Qty.kt`. */
private fun formatujStan(v: Double): String =
    if (v == v.toLong().toDouble()) v.toLong().toString() else v.toString()
