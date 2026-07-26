package pl.wertis.kolektor.ui.chrome

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

/* ── Feedback ekranowy: toast (2.6 s) i plakietka sukcesu (1.5 s) ──────────*/

class UiEffects(private val scope: CoroutineScope) {
    private val _toast = MutableStateFlow<String?>(null)
    val toastMsg: StateFlow<String?> = _toast

    private val _success = MutableStateFlow<String?>(null)
    val success: StateFlow<String?> = _success

    private var toastJob: Job? = null
    private var successJob: Job? = null

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
}
