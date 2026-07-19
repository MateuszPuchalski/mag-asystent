package pl.wertis.kolektor.undo

import pl.wertis.kolektor.core.net.ApiError
import pl.wertis.kolektor.core.offline.OfflineQueue
import pl.wertis.kolektor.data.QueueRepository
import pl.wertis.kolektor.net.ApiService
import pl.wertis.kolektor.net.apiCall
import pl.wertis.kolektor.ui.chrome.UiEffects

/* ── COFNIJ — port web/src/lib/undo.ts ──────────────────────────────────────
   Online: anulowanie zadania w kolejce Sfery (okno karencji ~5 s po stronie
   serwera; 409 = worker już zabrał). Offline: usunięcie operacji z bufora.   */

class UndoManager(
    private val api: ApiService,
    private val offlineQueue: OfflineQueue,
    private val queueRepo: QueueRepository,
    private val effects: UiEffects,
) {
    /** @return true gdy cofnięto (odśwież ekran po stronie wywołującego). */
    suspend fun performUndo(): Boolean {
        val info = effects.undo.value ?: return false
        effects.hideUndo()

        info.queueId?.let { queueId ->
            return try {
                apiCall { api.cancel(queueId) }
                queueRepo.refreshNow()
                effects.toast("Cofnięto")
                true
            } catch (e: Exception) {
                when {
                    e is ApiError && e.status == 409 ->
                        effects.toast("Już zapisane — zeskanuj ponownie, aby poprawić")
                    else -> effects.toast(e.message ?: "Nie udało się cofnąć")
                }
                false
            }
        }
        info.bufferId?.let { bufferId ->
            val removed = offlineQueue.remove(bufferId)
            effects.toast(if (removed) "Cofnięto (z bufora)" else "Operacja już wysłana")
            return removed
        }
        return false
    }
}
