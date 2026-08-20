package pl.wertis.kolektor.core.net

/* ── Wartość nagłówka HTTP ──────────────────────────────────────────────────
   Powstało z wywrotki produkcyjnej (0.60.3):

     FATAL EXCEPTION: OkHttp Dispatcher
     java.lang.IllegalArgumentException:
       Unexpected char 0x142 at 1 in x-user value: Błażej

   `0x142` to `ł`. OkHttp przepuszcza w wartości nagłówka wyłącznie znaki
   ` `–`~` oraz tabulator, a przy każdym innym RZUCA WYJĄTKIEM. Wyjątek leci
   z wątku dyspozytora, nikt go nie łapie — więc aplikacja nie odmawia
   połączenia, tylko ginie. Wywracał się każdy magazynier z ł, ż, ó, ę, ą, ś,
   ć, ń albo ź w nazwie konta, przy pierwszym żądaniu PO zalogowaniu.

   Kodujemy procentowo po bajtach UTF-8, a nie okrajamy znaki diakrytyczne:
   `x-user` ląduje w `events.user_id`, czyli w dzienniku audytu, a „Blazej"
   w dzienniku to strata danych, nie kosmetyka. Serwer odkodowuje wartość
   w `userOf()`.

   Nazwy czysto ASCII nie zawierają procentu, więc odkodowanie starej wartości
   jest tożsamością — zmiana działa wstecz w obie strony.                     */

/**
 * Znak, który OkHttp przepuści i który przetrwa dekodowanie.
 *
 * Procent odpada, bo zaczyna sekwencję. Plus odpada, bo część dekoderów
 * (formularzowych, `java.net.URLDecoder`) zamienia go na spację — nazwisko
 * przeszłoby wtedy przez sieć i wróciło zmienione, czyli po cichu.
 */
private fun czysty(c: Char): Boolean = c in ' '..'~' && c != '%' && c != '+'

/**
 * Wartość nadająca się na nagłówek HTTP — kodowanie procentowe UTF-8.
 *
 * Procent jest kodowany TAKŻE wtedy, gdy sam w sobie jest legalny. Bez tego
 * odkodowanie po drugiej stronie byłoby niejednoznaczne: nie dałoby się
 * odróżnić „50%" wpisanego przez człowieka od początku sekwencji.
 */
fun naglowekHttp(wartosc: String): String {
    if (wartosc.all(::czysty)) return wartosc
    val sb = StringBuilder(wartosc.length + 8)
    for (bajt in wartosc.toByteArray(Charsets.UTF_8)) {
        val c = bajt.toInt().toChar()
        if (czysty(c)) sb.append(c)
        else sb.append('%').append("%02X".format(bajt.toInt() and 0xFF))
    }
    return sb.toString()
}
