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
