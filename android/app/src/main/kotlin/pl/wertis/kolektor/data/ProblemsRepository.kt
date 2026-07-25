package pl.wertis.kolektor.data

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import pl.wertis.kolektor.core.net.ProblemView
import pl.wertis.kolektor.core.net.ResolveProblemBody
import pl.wertis.kolektor.net.ApiService
import pl.wertis.kolektor.net.apiCall

/* ── Nierozwiązane wyjątki (D8) ──────────────────────────────────────────────
   Wyjątek bez ekranu przestaje istnieć: zgłoszony w alejce i nigdy więcej nie
   zobaczony to ten sam brak wiedzy co przed wdrożeniem. Dlatego licznik jest
   pobierany przy starcie aplikacji i po każdej zmianie, a pasek nad treścią
   siedzi na każdym ekranie, dopóki lista nie zejdzie do zera.

   Bez pollingu — wyjątków przybywa w tempie ludzkim, nie maszynowym.         */

class ProblemsRepository(private val api: ApiService, private val scope: CoroutineScope) {
    private val _problems = MutableStateFlow<List<ProblemView>>(emptyList())
    val problems: StateFlow<List<ProblemView>> = _problems

    /** Czy pierwsze pobranie już się udało — banner nie mruga przy starcie. */
    private val _loaded = MutableStateFlow(false)
    val loaded: StateFlow<Boolean> = _loaded

    fun refresh() {
        scope.launch { refreshNow() }
    }

    suspend fun refreshNow() {
        try {
            _problems.value = apiCall { api.unresolvedProblems() }.problems
            _loaded.value = true
        } catch (_: Exception) {
            /* offline — trzymamy ostatnią znaną listę, licznik nie kłamie w drugą stronę */
        }
    }

    /** Zamknięcie wyjątku; zwraca komunikat błędu albo `null` przy sukcesie. */
    suspend fun resolve(id: Long, note: String?): String? = try {
        apiCall { api.resolveProblem(id, ResolveProblemBody(note?.takeIf { it.isNotBlank() })) }
        refreshNow()
        null
    } catch (e: Exception) {
        e.message ?: "Nie udało się zamknąć wyjątku"
    }
}
