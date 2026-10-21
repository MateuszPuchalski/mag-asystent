package pl.wertis.kolektor.core.product

import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/* ── Gotowe zdjęcie kartoteki: biały kwadrat, jak najlżejszy JPEG ────────────
   Decyzją właściciela zdjęcie w Subiekcie jest kwadratowe i waży jak najmniej.
   Serwer nie ma biblioteki obrazów, więc kwadrat składa urządzenie. Panel robi
   to w przeglądarce (`panel/src/zdjecia/obrobka.ts`), kolektor tutaj.

   Reguła jest ta sama w obu miejscach, liczba w liczbę. Inaczej ten sam towar
   miałby w Subiekcie inny kadr zależnie od tego, kto zrobił zdjęcie.

   Rachunek stoi w `:core` bez Bitmapy, bo tu ma test na tablicy pikseli.
   Rysowanie robi `device/KwadratZdjecia.kt`, a to da się sprawdzić tylko
   okiem na kolektorze.                                                       */

/** Piksel o alfie do tej wartości liczy się jako tło, nie treść. */
const val PROG_ALFY = 8

/** Bok gotowego kwadratu. Wystarcza karcie towaru i wydrukowi, a plik jest lżejszy niż przy 1024. */
const val MAKS_BOKU_GOTOWEGO = 800

/** Margines wokół towaru w kwadracie, jako część dłuższego boku treści. */
const val MARGINES_KWADRATU = 0.05

/** Twardy limit bajtów. Serwer przyjmuje 512 KB, zostawiamy zapas na nagłówki. */
const val LIMIT_BAJTOW = 500 * 1024

/** Waga, do której schodzimy z jakością. Kwadrat 800 px na białym zwykle mieści się w niej przy 70. */
const val CEL_BAJTOW_GOTOWEGO = 60 * 1024

/* Jakość schodzi krokami, bo pięć kodowań to ułamek sekundy. Poniżej 52 na
   białym tle widać kostki JPEG-a. Skala 0–100, bo tak bierze ją
   `Bitmap.compress`; w panelu te same liczby stoją jako ułamki. */
val JAKOSCI_GOTOWEGO = listOf(82, 75, 68, 60, 52)

data class Prostokat(val x: Int, val y: Int, val szer: Int, val wys: Int)

/** Bok kwadratu i miejsce treści w nim. */
data class Kwadrat(val bok: Int, val tresc: Prostokat)

/**
 * Najmniejszy prostokąt obejmujący piksele o alfie ponad próg.
 *
 * @param piksele ARGB wierszami, tak jak oddaje je `Bitmap.getPixels`
 * @return `null`, gdy po usunięciu tła nie zostało nic
 */
fun ramkaAlfy(piksele: IntArray, szer: Int, wys: Int, prog: Int = PROG_ALFY): Prostokat? {
    var x0 = szer
    var y0 = wys
    var x1 = -1
    var y1 = -1
    for (y in 0 until wys) {
        for (x in 0 until szer) {
            if ((piksele[y * szer + x] ushr 24) <= prog) continue
            if (x < x0) x0 = x
            if (x > x1) x1 = x
            if (y < y0) y0 = y
            if (y > y1) y1 = y
        }
    }
    if (x1 < 0) return null
    return Prostokat(x0, y0, x1 - x0 + 1, y1 - y0 + 1)
}

/**
 * Gdzie postawić treść w kwadracie.
 *
 * Kwadrat, bo Allegro i karta Subiekta kadrują miniatury do kwadratu, a towar
 * z wysokiego zdjęcia traci wtedy górę i dół. Bok nie przekracza `maks`, ale
 * też nie rośnie ponad treść z marginesem: powiększenie nie dodaje szczegółów,
 * tylko rozmywa.
 */
fun kwadratWokol(
    szer: Int,
    wys: Int,
    margines: Double = MARGINES_KWADRATU,
    maks: Int = MAKS_BOKU_GOTOWEGO,
): Kwadrat {
    val dluzszy = max(max(szer, wys), 1)
    val pas = (dluzszy * margines).roundToInt()
    val naturalny = dluzszy + 2 * pas
    val bok = min(maks, naturalny)
    val skala = bok.toDouble() / naturalny
    val dw = max(1, (szer * skala).roundToInt())
    val dh = max(1, (wys * skala).roundToInt())
    return Kwadrat(
        bok,
        Prostokat(floor((bok - dw) / 2.0).toInt(), floor((bok - dh) / 2.0).toInt(), dw, dh),
    )
}

/** Wynik kodowania: bajty pliku i jakość, która je dała. */
class Zakodowany(val bajty: ByteArray, val jakosc: Int, val miesciSie: Boolean)

/**
 * Najlżejszy plik, który jeszcze dobrze wygląda: pierwsza jakość mieszcząca
 * się w `cel`. Gdy żadna się nie mieści, bierze ostatnią, czyli najlżejszą
 * próbę. `miesciSie = false` znaczy wtedy, że ta przekracza twardy `limit`.
 */
fun zakodujJakNajlzej(
    jakosci: List<Int> = JAKOSCI_GOTOWEGO,
    cel: Int = CEL_BAJTOW_GOTOWEGO,
    limit: Int = LIMIT_BAJTOW,
    koduj: (jakosc: Int) -> ByteArray,
): Zakodowany {
    var ostatni = ByteArray(0)
    var jakosc = jakosci.first()
    for (q in jakosci) {
        ostatni = koduj(q)
        jakosc = q
        if (ostatni.size <= cel) return Zakodowany(ostatni, q, true)
    }
    return Zakodowany(ostatni, jakosc, ostatni.size <= limit)
}

/** Zdanie dla człowieka, gdy z wycięcia nie został żaden piksel towaru. */
const val BRAK_TRESCI =
    "Po usunięciu tła nie został żaden towar. Zostaw tło albo zrób zdjęcie jeszcze raz."

/** Zdanie dla człowieka, gdy nawet najniższa jakość przekracza limit serwera. */
const val ZA_DUZY = "Gotowe zdjęcie jest za duże nawet po kompresji. Zrób je jeszcze raz."
