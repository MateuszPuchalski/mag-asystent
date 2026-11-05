package pl.wertis.kolektor.core.net

import kotlinx.serialization.Serializable

/* ── DTO zgłoszeń pracowników — lustro `docs/zgloszenia-pracownikow.md` ────
   Ciało buduje `zgloszenieKolektora` z `core/zgloszenie`, nie ekran. Tam stoi
   też powód, dla którego `zrodlo` nie ma wartości domyślnej.               */

/** Ciało `POST /api/zgloszenia`. */
@Serializable
data class ZgloszenieBody(
    /** `pomysl`, `przeszkadza` albo `blad`. */
    val rodzaj: String,
    val opis: String,
    /** Nazwa ekranu bez żadnych argumentów, bo argument niesie dane. */
    val ekran: String,
    /* Bez wartości domyślnej, bo `WertisJson` nie wysyła pól równych
       domyślnej. Pole z domyślnym „kolektor" nie pojechałoby nigdy. */
    val zrodlo: String,
    val wersja: String? = null,
    /** Base64 JPEG bez nagłówka `data:`; `null` = bez zdjęć, pole nie jedzie. */
    val zdjecia: List<String>? = null,
)

/**
 * Złożone zgłoszenie. Kolektor czyta z odpowiedzi tylko identyfikator,
 * więc reszta kształtu nie musi tu stać, a `ignoreUnknownKeys` ją pomija.
 */
@Serializable
data class ZgloszenieZlozone(val id: Long = 0, val status: String = "nowe")

@Serializable
data class ZgloszenieResponse(val zgloszenie: ZgloszenieZlozone? = null)
