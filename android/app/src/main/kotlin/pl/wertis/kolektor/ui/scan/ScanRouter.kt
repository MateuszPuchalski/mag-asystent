package pl.wertis.kolektor.ui.scan

import pl.wertis.kolektor.AppGraph
import pl.wertis.kolektor.core.net.LocAction
import pl.wertis.kolektor.core.net.ScanResult
import pl.wertis.kolektor.core.nav.Screen
import pl.wertis.kolektor.core.pin.PinAction
import pl.wertis.kolektor.data.RecentEntry
import pl.wertis.kolektor.net.apiCall
import pl.wertis.kolektor.ui.product.LocChoice
import pl.wertis.kolektor.ui.product.saveLocation

/* ── Jedna droga skanu przez kontekst przyklejony ───────────────────────────
   Wcześniej ta sama obsługa („co zrobić z odpowiedzią /scan") żyła w dwóch
   kopiach: na ekranie głównym i w globalnym fallbacku. Kontekst przyklejony
   musi działać identycznie w obu, więc kopia znika.

   Rozstrzygnięcie ZASTĄP/DODAJ zostaje przy człowieku dokładnie tam, gdzie
   naprawdę jest decyzją (§5.3):
     0 lokalizacji  → dodaj po cichu, nie ma z czym kolidować,
     1 lokalizacja  → ZASTĄP, bo operacja nazywa się „zmiana lokalizacji",
     ≥2 lokalizacje → arkusz na karcie towaru; tam jest komplet informacji.   */

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
                when (val a = graph.pin.onProduct(r.card.id, r.card.sym)) {
                    is PinAction.Assign -> przypisz(graph, a, r.card.locs)
                    else -> graph.nav.openProduct(
                        r.card.id,
                        RecentEntry(r.card.id, r.card.sym, r.card.locs.firstOrNull() ?: "brak lokalizacji"),
                    )
                }
            }
            is ScanResult.Location -> {
                graph.feedback.beep(true)
                when (val a = graph.pin.onLoc(r.code)) {
                    is PinAction.Assign -> przypisz(graph, a, locsOf(graph, a.twId))
                    // pusty regał to poprawna odpowiedź — skanuje się półkę
                    // także po to, żeby sprawdzić, czy jest wolna
                    else -> graph.nav.openLocation(r.code)
                }
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

/** Lokalizacje przypiętego towaru — przy skanie półki nie mamy jego karty. */
private suspend fun locsOf(graph: AppGraph, twId: Long): List<String> =
    runCatching { apiCall { graph.api.product(twId) }.locs }.getOrDefault(emptyList())

private suspend fun przypisz(graph: AppGraph, a: PinAction.Assign, obecne: List<String>) {
    if (obecne.size > 1) {
        // realna decyzja człowieka — arkusz na karcie, gdzie widać wszystkie
        graph.nav.openProductWithLoc(a.twId, a.code)
        return
    }
    val akcja = if (obecne.isEmpty()) LocAction.ADD else LocAction.REPLACE
    val opis = if (obecne.isEmpty()) "${a.sym} → ${a.code}" else "${a.sym}: ${obecne[0]} → ${a.code}"
    try {
        saveLocation(graph, a.twId, LocChoice(akcja, a.code), opis, graph.locationsRepo.cached())
    } catch (e: Exception) {
        graph.feedback.beep(false)
        graph.effects.toast(e.message ?: "Błąd zapisu")
    }
}

/** Globalny fallback: skan z ekranu, który go nie przechwycił. */
suspend fun globalScan(graph: AppGraph, code: String) = routeScan(graph, code) {
    graph.nav.pendingSearch = it
    graph.nav.go(Screen.HOME)
}
