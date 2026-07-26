package pl.wertis.kolektor.data

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import pl.wertis.kolektor.core.net.DeviceEventBody
import pl.wertis.kolektor.net.ApiService
import pl.wertis.kolektor.net.apiCall

/* ── Pomiar odczuwanego opóźnienia (plan §10) ───────────────────────────────
   `p95` czasu skan → informacja zwrotna ma być poniżej 150 ms. Powyżej ~300 ms
   ludzie zaczynają skanować podwójnie, a podwójny skan przy liczeniu pozycji
   to błąd ILOŚCIOWY — czyli koszt, który wychodzi dopiero przy inwentaryzacji.

   Mierzy KLIENT, nie serwer: czas obsługi po stronie serwera pomija sieć
   i render, więc dawałby fałszywie optymistyczną liczbę akurat tam, gdzie
   problem naprawdę siedzi (Wi-Fi przy metalowych regałach).

   Wysyłka jest fire-and-forget, poza ścieżką skanu — telemetria nie może
   spowalniać tego, co mierzy.                                                */

class TelemetryRepository(private val api: ApiService, private val scope: CoroutineScope) {

    fun scanTiming(ms: Long) {
        scope.launch {
            runCatching { apiCall { api.deviceEvent(DeviceEventBody(type = "scan_timing", ms = ms)) } }
        }
    }
}
