package pl.wertis.kolektor.data

import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ProcessLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import pl.wertis.kolektor.core.net.QueueResponse
import pl.wertis.kolektor.net.ApiService
import pl.wertis.kolektor.net.apiCall

/* ── Jedna wspólna pętla pollingu kolejki Sfery (1.5 s) ─────────────────────
   Zasila pastylkę statusu na każdym ekranie ORAZ ekran kolejki — bez
   zdublowanych żądań (odpowiednik useQueue z refetchInterval 1500).
   Polling działa tylko gdy aplikacja jest na wierzchu (ProcessLifecycle).
   refreshNow() po każdym zapisie = odpowiednik inwalidacji query.            */

class QueueRepository(private val api: ApiService, scope: CoroutineScope) {
    private val _queue = MutableStateFlow<QueueResponse?>(null)
    val queue: StateFlow<QueueResponse?> = _queue

    private val kick = MutableSharedFlow<Unit>(extraBufferCapacity = 1, onBufferOverflow = BufferOverflow.DROP_OLDEST)

    init {
        scope.launch {
            ProcessLifecycleOwner.get().lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
                while (true) {
                    try {
                        _queue.value = apiCall { api.queue() }
                    } catch (_: Exception) {
                        /* offline / serwer w restarcie — pastylka trzyma ostatni stan */
                    }
                    // czekaj 1.5 s ALBO obudź się natychmiast po refreshNow()
                    withTimeoutOrNull(1500) { kick.first() }
                }
            }
        }
    }

    /** Natychmiastowe odświeżenie po zapisie (setLocation/MM/retry/cancel…). */
    fun refreshNow() {
        kick.tryEmit(Unit)
    }
}
