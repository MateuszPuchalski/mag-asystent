package pl.wertis.kolektor.core.zgloszenie

import pl.wertis.kolektor.core.nav.Screen
import pl.wertis.kolektor.core.net.ZgloszenieBody

/* ── Zgłoszenie uwagi pracownika ─────────────────────────────────────────────
   Kontrakt stoi w `docs/zgloszenia-pracownikow.md`. Tu mieszkają reguły,
   które ekran musiałby inaczej pamiętać sam: co blokuje wysyłkę, jak
   wygląda ciało i kiedy zdjęcie mieści się w limicie serwera.

   Reguły stoją w `:core`, bo tylko tu biegną testy bez Android SDK.
   Pomyłka w ciele żądania jest cicha: ekran wygląda dobrze, a serwer
   odpowiada odmową dopiero na hali.                                        */

/**
 * Rodzaj zgłoszenia. Trzy kafle zamiast listy, bo rękawica trafia w kafel.
 * Domyślnego rodzaju nie ma: z góry zaznaczony kafel przechodziłby
 * niezmieniony i każde zgłoszenie wyglądałoby na pomysł.
 */
enum class RodzajZgloszenia(val klucz: String, val etykieta: String, val podpowiedz: String) {
    POMYSL("pomysl", "Pomysł", "Co by Ci pomogło w pracy?"),
    PRZESZKADZA("przeszkadza", "Przeszkadza mi", "Co przeszkadza i przy jakiej czynności?"),
    BLAD("blad", "Nie działa", "Co zrobiłeś i co się wtedy stało?"),
}

/** Źródło zgłoszenia według kontraktu; panel wysyła `panel`. */
const val ZRODLO_KOLEKTOR = "kolektor"

const val ZGLOSZENIE_MAX_ZDJEC = 4
const val ZGLOSZENIE_MAX_OPIS = 4000
const val ZGLOSZENIE_MAX_WERSJA = 40

/** Limit serwera na jedno zdjęcie po zdekodowaniu: 1024 kB. */
const val ZDJECIE_ZGLOSZENIA_MAX_BAJTOW = 1024 * 1024

/** Jedna próba zakodowania kadru: dłuższy bok w pikselach i jakość JPEG. */
data class ProbaZdjecia(val bok: Int, val jakosc: Int)

/**
 * Kolejne próby, od najlepszej. Pierwsza to wartości z kontraktu i daje
 * zwykle 200–400 kB. Dwie następne łapią kadr pełen drobnego wzoru, który
 * kompresuje się gorzej, zamiast kazać człowiekowi robić zdjęcie od nowa.
 */
val PROBY_ZDJECIA: List<ProbaZdjecia> = listOf(
    ProbaZdjecia(bok = 1600, jakosc = 80),
    ProbaZdjecia(bok = 1600, jakosc = 65),
    ProbaZdjecia(bok = 1280, jakosc = 60),
)

/**
 * Ekran zgłoszenia: nazwa z mapy nawigacji, sama i bez argumentów.
 * Ten sam klucz niesie już pomiar czasów odpowiedzi, więc obie listy
 * da się zestawić. Argument ekranu (kod, numer dostawy) jest daną.
 */
fun ekranZgloszenia(screen: Screen): String = screen.name

/**
 * Bajty po zdekodowaniu base64, bez dekodowania. Prefiks `data:` jest
 * dopuszczony w kontrakcie, więc liczymy dopiero od przecinka.
 */
fun bajtyBase64(b64: String): Int {
    val tresc = b64.substringAfter("base64,", b64).filterNot { it.isWhitespace() }
    val dopelnienie = tresc.takeLastWhile { it == '=' }.length.coerceAtMost(2)
    return tresc.length / 4 * 3 + (tresc.length % 4).let { if (it > 1) it - 1 else 0 } - dopelnienie
}

fun zdjecieMiesciSie(b64: String): Boolean = bajtyBase64(b64) <= ZDJECIE_ZGLOSZENIA_MAX_BAJTOW

/**
 * Pierwsze kodowanie z `PROBY_ZDJECIA`, które mieści się w limicie.
 *
 * Gdy żadne się nie mieści, wraca ostatnie, najmniejsze. Odmowę i jej zdanie
 * da wtedy serwer, bo kolektor nie powinien zgadywać limitu za niego.
 * `null` od kodera znaczy nieczytelny plik i kończy próby od razu.
 */
fun zakodujZdjecieZgloszenia(koduj: (ProbaZdjecia) -> String?): String? {
    var ostatnie: String? = null
    for (proba in PROBY_ZDJECIA) {
        val b64 = koduj(proba) ?: return null
        if (zdjecieMiesciSie(b64)) return b64
        ostatnie = b64
    }
    return ostatnie
}

/**
 * Zdanie pod przyciskiem WYŚLIJ albo `null`, gdy wolno wysłać.
 * Brak wyboru tłumaczy się zdaniem, bo wyszarzony przycisk bez powodu
 * każe zgadywać, czego brakuje.
 */
fun blokadaZgloszenia(rodzaj: RodzajZgloszenia?, opis: String, zdjec: Int): String? {
    val tekst = opis.trim()
    return when {
        rodzaj == null -> "Wybierz: pomysł, przeszkadza mi albo nie działa."
        tekst.isEmpty() -> "Opisz w kilku słowach, co zauważyłeś."
        tekst.length > ZGLOSZENIE_MAX_OPIS -> "Opis ma ${tekst.length} znaków, a mieści się $ZGLOSZENIE_MAX_OPIS. Skróć go."
        zdjec > ZGLOSZENIE_MAX_ZDJEC -> "Najwyżej $ZGLOSZENIE_MAX_ZDJEC zdjęcia. Usuń jedno."
        else -> null
    }
}

/** Czy arkusz ma coś, czego szkoda stracić przy przypadkowym zamknięciu. */
fun szkicNiePusty(rodzaj: RodzajZgloszenia?, opis: String, zdjec: Int): Boolean =
    rodzaj != null || opis.isNotBlank() || zdjec > 0

/**
 * Ciało żądania. Opis jedzie przycięty, bo serwer liczy limit po przycięciu.
 * Pusta lista zdjęć nie jedzie wcale, bo pole jest w kontrakcie opcjonalne.
 */
fun zgloszenieKolektora(
    rodzaj: RodzajZgloszenia,
    opis: String,
    ekran: String,
    wersja: String?,
    zdjecia: List<String>,
): ZgloszenieBody = ZgloszenieBody(
    rodzaj = rodzaj.klucz,
    opis = opis.trim(),
    ekran = ekran.substringBefore('?').substringBefore('#'),
    zrodlo = ZRODLO_KOLEKTOR,
    wersja = wersja?.trim()?.take(ZGLOSZENIE_MAX_WERSJA)?.takeIf { it.isNotEmpty() },
    zdjecia = zdjecia.take(ZGLOSZENIE_MAX_ZDJEC).takeIf { it.isNotEmpty() },
)

/**
 * Skan przy otwartym arkuszu dopisuje kod do opisu. Najczęstsza uwaga
 * z hali dotyczy kodu, który nie działa, a przepisywanie go w rękawicy
 * jest najdłuższym pisaniem w całym zgłoszeniu.
 */
fun dopiszKod(opis: String, kod: String): String {
    val k = kod.trim()
    if (k.isEmpty()) return opis
    return when {
        opis.isBlank() -> k
        opis.endsWith(" ") || opis.endsWith("\n") -> opis + k
        else -> "$opis $k"
    }
}

/**
 * Zdanie błędu dla człowieka. Serwer mówi po polsku i jego zdanie wygrywa.
 * Wyjątkiem jest 413 z samego Fastify, który mówi po angielsku.
 */
fun zdanieBleduZgloszenia(status: Int, zdanieSerwera: String?): String = when {
    status == 413 -> "Zdjęcia są za duże dla serwera. Usuń jedno i wyślij jeszcze raz."
    !zdanieSerwera.isNullOrBlank() -> zdanieSerwera
    else -> "Serwer odrzucił zgłoszenie (błąd $status). Spróbuj jeszcze raz."
}
