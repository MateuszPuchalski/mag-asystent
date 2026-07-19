package pl.wertis.kolektor.data

import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.withTimeoutOrNull

/* Pętla odpytywania — odpowiednik refetchInterval z TanStack Query.
   Ostatnia dobra wartość jest trzymana między nieudanymi odczytami. */

data class Poll<T>(val data: T? = null, val error: String? = null, val loading: Boolean = true)

fun <T> pollFlow(
    intervalMs: Long,
    kick: SharedFlow<Unit>? = null,
    fetch: suspend () -> T,
): Flow<Poll<T>> = flow {
    var last: T? = null
    while (true) {
        try {
            last = fetch()
            emit(Poll(last, error = null, loading = false))
        } catch (e: Exception) {
            emit(Poll(last, error = e.message ?: "błąd", loading = false))
        }
        if (kick != null) withTimeoutOrNull(intervalMs) { kick.first() } else delay(intervalMs)
    }
}
