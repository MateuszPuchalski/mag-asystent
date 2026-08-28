package pl.wertis.kolektor.core.text

/* ── Szukanie po liście, którą kolektor ma już w ręce ────────────────────────
   ZGŁOSZENIE Z HALI: filtr w otwartej dostawie „nie działa". Nie zawieszał
   się — po prostu porównywał wpisany tekst DOSŁOWNIE, przez `contains` na
   małych literach. Wystarczyło więc każde z czterech odstępstw, które
   w magazynie są normą, żeby lista wyszła pusta przy towarze leżącym
   w kartonie:

     `gaznik`      nie znajdował `Gaźnik`      — ogonków nikt nie pisze,
     `ls51139`     nie znajdował `LS51-139`    — myślnik jest ozdobnikiem,
     `kosa spalin` nie znajdował `Spalinowa kosa` — kolejność słów jest luźna,
     `gaznk`       nie znajdował niczego       — literówka w rękawicy.

   Serwer rozwiązał to samo dawno (`server/src/tekst.ts`) i ten plik jest
   przeniesieniem TAMTYCH reguł, nie nowym pomysłem. Dwie różne odpowiedzi na
   „czy ten towar pasuje do wpisanego słowa" byłyby gorsze niż brak jednej:
   magazynier szukałby tego samego towaru dwa razy, dwoma polami, i dostawał
   dwa różne wyniki.

   Czego tu NIE MA i to jest decyzja: rankingu. Serwer sortuje wyniki po
   trafności i stanie magazynowym, bo wybiera kilkanaście pozycji z 3600.
   Tutaj filtrujemy listę, którą człowiek widzi w całości — kolejność ma
   zostać ta, którą ustawiło rozkładanie (alejkami, zrobione na dole).       */

/** Polskie znaki na ASCII. Wielkością liter zajmuje się `lowercase()`. */
private val LITERY: Map<Char, Char> = mapOf(
    'ą' to 'a', 'ć' to 'c', 'ę' to 'e', 'ł' to 'l', 'ń' to 'n',
    'ó' to 'o', 'ś' to 's', 'ź' to 'z', 'ż' to 'z',
)

/** Znaki, które w symbolach i kodach nic nie znaczą: `LS51-139` = `LS51 139`. */
private val ODDZIELACZE = charArrayOf(' ', '-', '.', '/', ',')

/** Ile znaków zapytania w ogóle bierzemy pod uwagę. */
private const val MAX_ZNAKOW = 100

/** Ile słów. Wklejony opis to trzydzieści tokenów na każdą pozycję listy. */
private const val MAX_TOKENOW = 6

/**
 * Małe litery i polskie znaki na ASCII; spacje i myślniki ZOSTAJĄ.
 *
 * To poziom „słowa dają się porównać". Drugi poziom (`zwin`) zdejmuje
 * oddzielacze — i te dwa muszą zostać osobne, bo furtka literówkowa porównuje
 * zapytanie ze SŁOWAMI nazwy. Na formie zwiniętej słów już nie ma, a odległość
 * edycyjna od `gaznikkompletnydokosy` przekroczy każdy rozsądny próg.
 */
fun zloz(s: String): String {
    val male = s.lowercase()
    val sb = StringBuilder(male.length)
    for (z in male) sb.append(LITERY[z] ?: z)
    return sb.toString()
}

/**
 * `zloz` bez oddzielaczy — forma do porównywania symboli i kodów.
 *
 * Dzięki niej `LS51139`, `ls51-139` i `LS51 139` to jedno i to samo. Etykieta
 * bywa zdarta, a numer przepisywany z ręki, więc myślnik w środku jest
 * ozdobnikiem, nie treścią.
 */
fun zwin(s: String): String {
    val zlozony = zloz(s)
    val sb = StringBuilder(zlozony.length)
    for (z in zlozony) if (z !in ODDZIELACZE) sb.append(z)
    return sb.toString()
}

/**
 * Zapytanie rozbite na słowa, każde złożone i zwinięte.
 *
 * PUSTA LISTA JEST WYNIKIEM ISTOTNYM: zapytanie `-`, `///` albo same spacje
 * nie ma ani jednego słowa, a koniunkcja po pustym zbiorze jest prawdziwa —
 * bez tego filtr przepuszczałby wtedy wszystko, udając, że coś znalazł.
 */
fun tokenySzukania(q: String): List<String> =
    zloz(q.take(MAX_ZNAKOW))
        .split(*ODDZIELACZE)
        .map { zwin(it) }
        .filter { it.isNotEmpty() }
        .take(MAX_TOKENOW)

/**
 * Ile błędów wolno wybaczyć słowu tej długości; `null` = żadnych.
 *
 * Próg DŁUGOŚCI jest ważniejszy od progu odległości: jeden błąd na trzech
 * znakach dopasowuje pół kartoteki (`kos` = `kot` = `koc` = `kod`), więc
 * krótkie słowa nie wchodzą do dopasowania przybliżonego wcale. Te same progi
 * co na serwerze — patrz `progLiterowki` w `server/src/tekst.ts`.
 */
fun progLiterowki(dlugosc: Int): Int? = when {
    dlugosc <= 3 -> null
    dlugosc <= 5 -> 1
    else -> 2
}

/**
 * Odległość edycyjna liczona w PAŚMIE, z przerwaniem po przekroczeniu progu.
 *
 * Zwraca `max + 1`, gdy odległość jest większa niż `max` — nie prawdziwą
 * wartość, bo nikt jej nie potrzebuje, a policzenie kosztuje.
 */
fun odlegloscOgraniczona(a: String, b: String, max: Int): Int {
    if (a == b) return 0
    if (kotlin.math.abs(a.length - b.length) > max) return max + 1
    if (max <= 0) return 1

    var poprzedni = IntArray(b.length + 1) { it }
    var biezacy = IntArray(b.length + 1)
    for (i in 1..a.length) {
        biezacy[0] = i
        val od = maxOf(1, i - max)
        val doJ = minOf(b.length, i + max)
        // poza pasmem wstawiamy wartość zaporową, żeby sąsiad jej nie „pożyczył"
        if (od > 1) biezacy[od - 1] = max + 1
        var najlepszy = biezacy[od - 1]
        for (j in od..doJ) {
            val koszt = if (a[i - 1] == b[j - 1]) 0 else 1
            biezacy[j] = minOf(poprzedni[j] + 1, biezacy[j - 1] + 1, poprzedni[j - 1] + koszt)
            if (biezacy[j] < najlepszy) najlepszy = biezacy[j]
        }
        for (j in doJ + 1..b.length) biezacy[j] = max + 1
        // cały wiersz ponad progiem — dalej może już tylko rosnąć
        if (najlepszy > max) return max + 1
        val tmp = poprzedni
        poprzedni = biezacy
        biezacy = tmp
    }
    return minOf(poprzedni[b.length], max + 1)
}

/** Jedna pozycja listy sprowadzona do form, po których się szuka. */
private class Sito(val symbol: String, val nazwa: String) {
    val symZwiniety = zwin(symbol)
    val nazwaZlozona = zloz(nazwa)
    val nazwaZwinieta = zwin(nazwa)
    /** Słowa nazwy i symbol — to z nimi porównuje się literówkę. */
    val slowa: List<String> =
        (nazwaZlozona.split(*ODDZIELACZE).map { zwin(it) } + symZwiniety).filter { it.isNotEmpty() }

    fun trafiaDoslownie(token: String): Boolean =
        symZwiniety.contains(token) ||
            nazwaZlozona.contains(token) ||
            /* Nazwa ZWINIĘTA tylko dla tokenów z cyfrą — ta sama granica co na
               serwerze. `sw40` ma znaleźć „SW-40 olej", ale token bez cyfry
               porównywany z nazwą bez spacji zaczyna łapać sklejki dwóch
               sąsiednich słów, a to już nie jest to, o co ktoś pytał. */
            (token.any { it.isDigit() } && nazwaZwinieta.contains(token))

    fun trafiaZLiterowka(token: String): Boolean {
        val prog = progLiterowki(token.length) ?: return false
        return slowa.any { odlegloscOgraniczona(token, it, prog) <= prog }
    }
}

/**
 * Pozycje pasujące do wpisanego tekstu; pusty tekst nie filtruje niczego.
 *
 * Wszystkie słowa zapytania muszą trafić (koniunkcja), każde osobno w symbol
 * albo w nazwę — dzięki temu „kosa spalinowa" i „spalinowa kosa" znajdują to
 * samo, a „kosa 40" zawęża do jednej pozycji.
 *
 * FURTKA LITERÓWKOWA ODPALA SIĘ WYŁĄCZNIE PRZY ZERZE WYNIKÓW i to jest cała
 * jej bezpieczna postać — tak samo jak na serwerze. Dopasowanie rozmyte
 * wmieszane w wynik dosłowny wciąga do listy sąsiadów (`gaz` łapie `gips`)
 * i psuje trafienie, które było dobre. Jako odpowiedź na „nic nie znalazłem"
 * nie ma czego zepsuć, a płaci się za nią dokładnie wtedy, gdy człowiek utknął.
 */
fun <T> filtrujSzukaniem(
    pozycje: List<T>,
    zapytanie: String,
    symbol: (T) -> String,
    nazwa: (T) -> String,
): List<T> {
    val tokeny = tokenySzukania(zapytanie)
    if (tokeny.isEmpty()) return pozycje

    val sita = pozycje.map { Sito(symbol(it), nazwa(it)) }
    val doslowne = pozycje.filterIndexed { i, _ -> tokeny.all { t -> sita[i].trafiaDoslownie(t) } }
    if (doslowne.isNotEmpty()) return doslowne

    return pozycje.filterIndexed { i, _ ->
        tokeny.all { t -> sita[i].trafiaDoslownie(t) || sita[i].trafiaZLiterowka(t) }
    }
}
