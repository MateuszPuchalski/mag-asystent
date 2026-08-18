package pl.wertis.kolektor.core.text

/**
 * Liczby ilości: bez `.0` dla całkowitych (JS number → Double).
 *
 * Mieszka w `:core`, a nie przy klockach UI, odkąd teksty karty towaru
 * (`core/product/KartaTekst.kt`) składają się z ilości same. Gdyby formatowanie
 * zostało w `:app`, funkcje tekstowe musiałyby przyjmować gotowe łańcuchy —
 * a wtedy ich test sprawdzałby sklejanie, nie regułę.
 */
fun formatQty(v: Double): String =
    if (v == v.toLong().toDouble()) v.toLong().toString() else v.toString()

/**
 * Jednostka do wyświetlenia — z kartoteki, a gdy serwer jej nie podał: „szt.".
 *
 * Reguła zapasowa mieszka TUTAJ, bo do 0.51.0 leżała rozsypana po dwunastu
 * miejscach `:app` jako wpisane z palca „szt". Kartoteka ma 3415 pozycji,
 * z czego 18 mierzy się inaczej (`kpl.`, `par`) — dla nich wbite słowo
 * zamieniało trzy KOMPLETY z dokumentu w trzy sztuki. Pusty łańcuch znaczy
 * „starszy serwer albo kartoteka bez jednostki"; wtedy podstawiamy formę
 * dominującą w kartotece, z kropką, żeby jedna aplikacja nie pisała tego
 * samego słowa na dwa sposoby.
 */
fun jednostka(unit: String): String = unit.ifBlank { "szt." }

/** Ilość podpisana jednostką: `3 kpl.`, `12 szt.`, `2.5 m`. */
fun iloscZJednostka(qty: Double, unit: String): String = "${formatQty(qty)} ${jednostka(unit)}"
