package pl.wertis.kolektor.data

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import pl.wertis.kolektor.core.net.LicznikCzasow
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

    /**
     * Paczka czasów odpowiedzi co 5 minut (0.475.0) — reguły w `CzasyZadan.kt`.
     *
     * Rytm to kompromis: częściej i telemetria zaczęłaby się liczyć w ruchu,
     * który mierzy; rzadziej i przerwana zmiana (bateria, restart) zabrałaby
     * ze sobą za dużo pomiarów. Nieudana wysyłka oddaje paczkę do licznika.
     */
    fun wysylajCzasy(licznik: LicznikCzasow) {
        scope.launch {
            while (true) {
                delay(RYTM_CZASOW_MS)
                val paczka = licznik.zrzut()
                if (paczka.isEmpty()) continue
                try {
                    apiCall { api.deviceEvent(DeviceEventBody(type = "czasy_zadan", czasy = paczka)) }
                } catch (_: Exception) {
                    licznik.oddaj(paczka)
                }
            }
        }
    }
}

private const val RYTM_CZASOW_MS = 5 * 60_000L
