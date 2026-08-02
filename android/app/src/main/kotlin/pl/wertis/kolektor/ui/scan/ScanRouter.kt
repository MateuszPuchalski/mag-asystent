package pl.wertis.kolektor.ui.scan

import pl.wertis.kolektor.AppGraph
import pl.wertis.kolektor.core.net.ScanResult
import pl.wertis.kolektor.core.nav.Screen
import pl.wertis.kolektor.data.RecentEntry
import pl.wertis.kolektor.net.apiCall

/* ── Jedna droga skanu ──────────────────────────────────────────────────────
   Wcześniej ta sama obsługa („co zrobić z odpowiedzią /scan") żyła w dwóch
   kopiach: na ekranie głównym i w globalnym fallbacku. Kopia znika.

   KONTEKSTEM JEST OTWARTY EKRAN, nie ukryty stan. Skan robi dokładnie to, co
   widać:
     karta towaru otwarta + skan regału → TEN towar dostaje ten adres
       (przechwytuje `ProductScreen`, zanim skan tu dojdzie),
     skan regału bez otwartej karty     → pokaż zawartość regału,
     skan towaru                        → otwórz jego kartę.

   Wcześniej stał tu „kontekst przyklejony": pierwszy skan przypinał regał albo
   towar, a kolejne wpadały w to przypięcie. Oszczędzał skany (osiem indeksów na
   jeden regał to było 9 skanów zamiast 16), ale kosztem stanu, którego nie było
   widać na ekranie, na którym się stało. Dało się mieć przypięty towar A
   i otwartą kartę towaru B — pasek mówił wtedy jedno, a zapis szedł gdzie
   indziej. Adres zapisany na niewłaściwy towar jest błędem CICHYM: nic nie
   wygląda na zepsute, dopóki ktoś nie pójdzie po ten towar. Oszczędność siedmiu
   skanów tego nie warta.                                                      */

/**
 * @param onSearch co zrobić z wieloznacznym tekstem — ekran główny podstawia go
 *   do wyszukiwarki, pozostałe ekrany wracają na główny.
 */
suspend fun routeScan(
    graph: AppGraph,
    code: String,
    manual: Boolean = false,
    screen: String? = null,
    onSearch: (String) -> Unit,
) {
    val start = System.currentTimeMillis()
    try {
        val odpowiedz = apiCall { graph.api.scan(code, if (manual) "1" else null, screen) }
        // Czas MIERZONY U CZŁOWIEKA, nie na serwerze: powyżej ~300 ms ludzie
        // zaczynają skanować podwójnie, a podwójny skan przy liczeniu pozycji
        // to błąd ilościowy. Wysyłane obok, żeby nie wydłużać ścieżki skanu.
        graph.telemetry.scanTiming(System.currentTimeMillis() - start)
        when (val r = odpowiedz) {
            is ScanResult.Product -> {
                graph.feedback.beep(true)
                graph.nav.openProduct(
                    r.card.id,
                    RecentEntry(r.card.id, r.card.sym, r.card.locs.firstOrNull() ?: "brak lokalizacji"),
                )
            }
            is ScanResult.Location -> {
                graph.feedback.beep(true)
                // pusty regał to poprawna odpowiedź — półkę skanuje się także
                // po to, żeby sprawdzić, czy jest wolna
                graph.nav.openLocation(r.code)
            }
            is ScanResult.Search -> {
                graph.feedback.beep(true)
                onSearch(code)
            }
            is ScanResult.NotFound -> {
                graph.feedback.beep(false)
                graph.effects.toast("Nieznany kod kreskowy: ${r.code}")
            }
        }
    } catch (_: Exception) {
        graph.feedback.beep(false)
        graph.effects.toast("Błąd połączenia z serwerem")
    }
}

/** Globalny fallback: skan z ekranu, który go nie przechwycił. */
suspend fun globalScan(graph: AppGraph, code: String) = routeScan(graph, code) {
    graph.nav.pendingSearch = it
    graph.nav.go(Screen.HOME)
}
