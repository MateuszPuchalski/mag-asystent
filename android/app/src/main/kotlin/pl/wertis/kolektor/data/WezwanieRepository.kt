package pl.wertis.kolektor.data

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import pl.wertis.kolektor.core.kolektor.maDzwonic
import pl.wertis.kolektor.core.kolektor.wygaslo
import pl.wertis.kolektor.core.net.WezwanieKolektora
import pl.wertis.kolektor.device.Syrena
import pl.wertis.kolektor.net.ApiService
import pl.wertis.kolektor.net.apiCall

/* ── Czy ktoś szuka tego kolektora ──────────────────────────────────────────
   Serwer nie umie zawołać kolektora, więc kolektor pyta sam (nagłówek
   `services/szukanie-kolektora.ts`). Pętla żyje w zasięgu APLIKACJI, nie
   ekranu: zgubiony kolektor leży zwykle na ekranie głównym, który niczego
   nie odpytuje, a pętla przypięta do ekranów milczałaby dokładnie wtedy.

   RYTM 10 S to kompromis dwóch kosztów. Szukający czeka najwyżej tyle na
   pierwszy dźwięk i panel mówi mu to wprost. Częściej — i każdy kolektor
   w hali budziłby radio Wi-Fi co chwilę przez całą zmianę.

   GRANICA JEST UCZCIWA I JEDNA: pętla działa, dopóki działa proces. Przy
   „ekranie zawsze włączonym" (domyślnie tak) kolektor odłożony z otwartą
   aplikacją pyta do wyczerpania baterii. Po wyłączeniu ekranu przyciskiem
   Android usypia aplikację po swojemu i wtedy kolektor zadzwoni dopiero po
   przebudzeniu. Panel pokazuje to jako „cisza", zamiast obiecywać dźwięk. */

private const val RYTM_MS = 10_000L

class WezwanieRepository(
    private val api: ApiService,
    private val scope: CoroutineScope,
    private val syrena: Syrena,
    private val zalogowany: () -> Boolean,
    private val deviceId: String,
) {
    private val _wezwanie = MutableStateFlow<WezwanieKolektora?>(null)

    /** Wezwanie, które TERAZ dzwoni; `null` = cisza. Z tego rysuje się nakładka. */
    val wezwanie: StateFlow<WezwanieKolektora?> = _wezwanie

    /** Znacznik (`od`) wezwania zgaszonego ZNALAZŁEM — patrz `maDzwonic`. */
    @Volatile private var wyciszone: String? = null
    private var petla: Job? = null

    fun start() {
        if (petla != null) return
        petla = scope.launch {
            while (true) {
                sprawdz()
                delay(RYTM_MS)
            }
        }
    }

    private suspend fun sprawdz() {
        if (!zalogowany()) {
            ustaw(null)
            return
        }
        val w = try {
            apiCall { api.mojeWezwanie() }.wezwanie
        } catch (_: Exception) {
            /* Bez odpowiedzi nie zmieniamy zdania: dzwoniący kolektor, który
               wszedł w martwą strefę Wi-Fi, gra dalej — ale nie dłużej, niż
               serwer pozwolił. */
            val teraz = _wezwanie.value
            if (teraz != null && wygaslo(teraz, System.currentTimeMillis())) ustaw(null)
            return
        }
        if (w != null && w.od == wyciszone) {
            // zgłoszenie odnalezienia nie doszło — ponawiamy je po cichu
            zglosOdnalezienie()
        }
        ustaw(w)
    }

    private fun ustaw(w: WezwanieKolektora?) {
        val dzwon = maDzwonic(w, wyciszone)
        _wezwanie.value = if (dzwon) w else null
        if (dzwon) syrena.wlacz() else syrena.wylacz()
    }

    /** ZNALAZŁEM — cisza od razu, zgłoszenie w tle. */
    fun znalazlem() {
        val w = _wezwanie.value ?: return
        wyciszone = w.od
        ustaw(null)
        scope.launch { zglosOdnalezienie() }
    }

    private suspend fun zglosOdnalezienie() {
        runCatching { apiCall { api.zakonczSzukanie(deviceId) } }
    }
}
