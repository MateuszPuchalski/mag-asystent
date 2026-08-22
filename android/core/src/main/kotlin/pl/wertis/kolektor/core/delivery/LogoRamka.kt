package pl.wertis.kolektor.core.delivery

/* ── Widoczna część logo dostawcy ───────────────────────────────────────────
   POWSTAŁO ZE ZGŁOSZENIA „logo za małe na liście dostaw". Winny nie był slot
   na ekranie, tylko obraz: panel biura do 0.87.0 zapisywał każde logo
   wyśrodkowane w KWADRACIE 128×128. Logotyp jest szerokim paskiem z nazwą
   firmy, więc taki kwadrat to w dwóch trzecich przezroczyste powietrze —
   a `ContentScale.Fit` skaluje CAŁY obraz, razem z nim. Poszerzanie slotu nie
   dawało wtedy nic: rósł margines, nie logo.

   Panel zapisuje dziś obraz przycięty, ale loga wgrane wcześniej leżą w bazie
   takie, jakie były, a serwer nie ma czym ich przerobić (świadomie — patrz
   `services/logo-dostawcy.ts`). Dlatego kolektor przycina je sam, przy
   dekodowaniu, raz na logo. Kosztuje to jedno przejście po 16 tysiącach
   pikseli i zdejmuje z biura obowiązek wgrania wszystkiego od nowa.

   Reguła jest jedna i celowo tępa: TNIEMY WYŁĄCZNIE PRZEZROCZYSTOŚĆ. Logo na
   białym prostokącie (zwykły JPG) zostaje, jak jest — „prawie biały" piksel
   bywa częścią znaku, a obcięcie go byłoby zniekształceniem cudzego logotypu.

   Mieszka w `:core`, bo `:app` nie ma testów, a to jest arytmetyka, którą
   trzeba móc sprawdzić: pomyłka o jeden piksel przy krawędzi obcina literę.  */

/** Prostokąt widocznej treści w pikselach obrazu. */
data class RamkaLogo(val x: Int, val y: Int, val szer: Int, val wys: Int)

/** Poniżej tej wartości kanału alfa (0–255) piksel uznajemy za pusty. */
const val PROG_ALFA_LOGO = 8

/**
 * Prostokąt zajęty przez widoczne piksele; `null`, gdy obraz jest cały pusty.
 *
 * `null` znaczy „nie ma czego przyciąć" i wywołujący ma wtedy zostawić obraz
 * bez zmian. Przycięcie do zera pikseli byłoby zamianą dziwnego logo na brak
 * logo — a to już nie jest ta sama informacja.
 *
 * @param piksele ARGB wierszami, tak jak zwraca `Bitmap.getPixels`
 * @param szer szerokość obrazu w pikselach
 * @param wys wysokość obrazu w pikselach
 */
fun ramkaWidoczna(
    piksele: IntArray,
    szer: Int,
    wys: Int,
    prog: Int = PROG_ALFA_LOGO,
): RamkaLogo? {
    if (szer <= 0 || wys <= 0 || piksele.size < szer * wys) return null
    var x1 = szer
    var y1 = wys
    var x2 = -1
    var y2 = -1
    for (y in 0 until wys) {
        val wiersz = y * szer
        for (x in 0 until szer) {
            if ((piksele[wiersz + x] ushr 24) <= prog) continue
            if (x < x1) x1 = x
            if (x > x2) x2 = x
            if (y < y1) y1 = y
            if (y > y2) y2 = y
        }
    }
    if (x2 < 0) return null
    return RamkaLogo(x1, y1, x2 - x1 + 1, y2 - y1 + 1)
}

/**
 * Czy przycięcie w ogóle warto wykonać.
 *
 * Kopiowanie bitmapy po to, żeby zdjąć jeden piksel z brzegu, jest czystym
 * kosztem — a przy logo zapisanym już przyciętym (panel od 0.87.0) tak właśnie
 * by wychodziło. Próg 2% dłuższego boku odróżnia „obraz jest kwadratem
 * z powietrzem" od „krawędź wypadła o włos".
 */
fun wartoPrzyciac(ramka: RamkaLogo, szer: Int, wys: Int): Boolean {
    val luz = maxOf(szer, wys) / 50
    return ramka.x > luz ||
        ramka.y > luz ||
        szer - (ramka.x + ramka.szer) > luz ||
        wys - (ramka.y + ramka.wys) > luz
}
