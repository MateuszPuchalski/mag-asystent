package pl.wertis.kolektor.ui.chrome

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

/* ── Feedback ekranowy: toast / sukces / pasek COFNIJ ───────────────────────
   Czasy jak w web/src/lib/store.ts: toast 2.6 s, sukces 1.5 s, undo 6 s.     */

/** Pasek COFNIJ po auto-zapisie: queueId (online) lub bufferId (offline). */
data class UndoInfo(
    val msg: String,
    val queueId: Long? = null,
    val bufferId: String? = null,
    val warn: String? = null,
)

class UiEffects(private val scope: CoroutineScope) {
    private val _toast = MutableStateFlow<String?>(null)
    val toastMsg: StateFlow<String?> = _toast

    private val _success = MutableStateFlow<String?>(null)
    val success: StateFlow<String?> = _success

    private val _undo = MutableStateFlow<UndoInfo?>(null)
    val undo: StateFlow<UndoInfo?> = _undo

    private var toastJob: Job? = null
    private var successJob: Job? = null
    private var undoJob: Job? = null

    fun toast(msg: String) {
        toastJob?.cancel()
        _toast.value = msg
        toastJob = scope.launch { delay(2600); _toast.value = null }
    }

    fun flashSuccess(msg: String) {
        successJob?.cancel()
        _success.value = msg
        successJob = scope.launch { delay(1500); _success.value = null }
    }

    /** Auto-zapis z możliwością cofnięcia — pasek znika po oknie karencji. */
    fun showUndo(info: UndoInfo) {
        undoJob?.cancel()
        _undo.value = info
        undoJob = scope.launch { delay(6000); _undo.value = null }
    }

    fun hideUndo() {
        undoJob?.cancel()
        _undo.value = null
    }
}
