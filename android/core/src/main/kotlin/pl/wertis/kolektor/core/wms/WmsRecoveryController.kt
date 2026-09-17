package pl.wertis.kolektor.core.wms

import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import pl.wertis.kolektor.core.net.ApiError

interface WmsRecoveryTransport {
    suspend fun queue(query: String, offset: Int): WmsRecoveryQueue
    suspend fun recoveringTask(id: Long): WmsRecoveryTask
    suspend fun send(command: WmsPending): Long
}

data class WmsRecoveryView(
    val generation: Long = 0, val context: WmsContext? = null, val journal: WmsJournal = WmsJournal(),
    val task: WmsRecoveryTask? = null, val queue: WmsRecoveryQueue? = null,
    val query: String = "", val offset: Int = 0, val busy: Boolean = false, val ready: Boolean = false,
    val message: String? = null,
)

/** Wspólny dziennik chroni wynik wymiany przed przykryciem kolejną pracą.
 * Powrót wymaga świeżego stanu i skanów; utracone podjęcie odzyskuje także numer zadania. */
class WmsRecoveryController(
    private val store: WmsStore,
    private val transport: (WmsContext) -> WmsRecoveryTransport,
    private val lock: Mutex = Mutex(),
    private val newKey: () -> String = { UUID.randomUUID().toString() },
) {
    private var generation = 0L
    private val verification = WmsVerification()
    private val mutable = MutableStateFlow(WmsRecoveryView())
    val state: StateFlow<WmsRecoveryView> = mutable

    fun activateVerification() {
        verification.activate()
        mutable.value = mutable.value.copy(generation = ++generation, ready = false)
    }

    fun invalidateVerification() {
        verification.invalidate()
        mutable.value = mutable.value.copy(generation = ++generation, ready = false)
    }

    suspend fun open(context: WmsContext) = read(context, resume = true)
    suspend fun select(context: WmsContext, id: Long) = read(context, taskId = id)
    suspend fun queue(context: WmsContext, query: String = "", offset: Int = 0) = read(context, query = query, offset = offset)

    private suspend fun read(context: WmsContext, resume: Boolean = false, taskId: Long? = null, query: String = "", offset: Int = 0, epoch: Long? = verification.capture()) = lock.withLock {
        if (!verification.matches(epoch)) return@withLock
        mutable.value = WmsRecoveryView(generation = ++generation, context = context, busy = true, query = query, offset = offset)
        try {
            require(query.length <= 120 && offset in 0..1000000) { "Zbyt długi filtr kolejki" }
            val journal = store.read()
            mutable.value = mutable.value.copy(journal = journal)
            if (journal.pending != null) {
                mutable.value = mutable.value.copy(message = "Najpierw sprawdź wynik ostatniego zapisu WMS")
                return@withLock
            }
            val selected = if (resume) journal.recovering?.takeIf { it.context == context }?.taskId else taskId
            val client = transport(context)
            if (selected != null) {
                load(context, selected, client, epoch)
                val next = journal.copy(recovering = WmsActiveRecovery(context, selected))
                store.write(next)
                mutable.value = mutable.value.copy(journal = next)
            } else {
                val queue = client.queue(query, offset)
                val next = journal.copy(recovering = null)
                store.write(next)
                mutable.value = mutable.value.copy(journal = next, queue = queue, ready = verification.matches(epoch))
            }
        } catch (e: CancellationException) { throw e }
        catch (e: Exception) { problem(e) }
        finally { mutable.value = mutable.value.copy(busy = false) }
    }

    suspend fun submit(context: WmsContext, draft: WmsRecoveryDraft) {
        if (!lock.tryLock()) return
        try {
            val view = mutable.value
            if (view.context != context || !view.ready || view.busy || view.task?.id != draft.taskId) return
            val epoch = verification.capture() ?: return
            val latest = store.read()
            if (!verification.matches(epoch)) return
            mutable.value = view.copy(journal = latest, ready = false)
            if (latest.pending != null) {
                mutable.value = mutable.value.copy(message = "Najpierw rozlicz ostatni zapis WMS")
                return
            }
            mutable.value = mutable.value.copy(busy = true, message = null)
            val pending = WmsPending(newKey(), context, draft.path, draft.body, draft.description, workflow = "pack-recovery", taskId = draft.taskId)
            val next = latest.copy(pending = pending, recovering = WmsActiveRecovery(context, draft.taskId))
            store.write(next)
            mutable.value = mutable.value.copy(journal = next)
            send(context, pending, epoch)
        } catch (e: CancellationException) { throw e }
        catch (e: Exception) { problem(e) }
        finally { mutable.value = mutable.value.copy(busy = false); lock.unlock() }
    }

    suspend fun retry(context: WmsContext) {
        if (!lock.tryLock()) return
        try {
            if (mutable.value.context != context) return
            val epoch = verification.capture() ?: return
            val journal = store.read()
            if (!verification.matches(epoch)) return
            mutable.value = mutable.value.copy(journal = journal)
            val pending = journal.pending ?: return
            if (pending.context != context || pending.workflow != "pack-recovery") return
            mutable.value = mutable.value.copy(busy = true, ready = false, message = null)
            send(context, pending, epoch)
        } catch (e: CancellationException) { throw e }
        catch (e: Exception) { problem(e) }
        finally { mutable.value = mutable.value.copy(busy = false); lock.unlock() }
    }

    private suspend fun send(context: WmsContext, pending: WmsPending, epoch: Long?) {
        val client = transport(context)
        var rejection: String? = null
        val id = try { client.send(pending) } catch (e: ApiError) {
            if (!definitiveWmsRejection(e)) throw e
            rejection = e.message
            pending.taskId
        }
        if (id != null) require(id > 0 && (pending.taskId == null || pending.taskId == id)) { "Nieznana odpowiedź wymiany" }
        val journal = mutable.value.journal.copy(pending = null, recovering = id?.let { WmsActiveRecovery(context, it) })
        store.write(journal)
        mutable.value = mutable.value.copy(journal = journal)
        if (id != null) load(context, id, client, epoch) else {
            val queue = client.queue("", 0)
            mutable.value = mutable.value.copy(generation = ++generation, queue = queue, task = null, query = "", offset = 0, ready = verification.matches(epoch))
        }
        mutable.value = mutable.value.copy(message = rejection)
    }

    private suspend fun load(context: WmsContext, id: Long, client: WmsRecoveryTransport, epoch: Long?) {
        val task = client.recoveringTask(id)
        require(task.id == id && task.lines.isNotEmpty()) { "Nieznana odpowiedź zadania" }
        mutable.value = mutable.value.copy(generation = ++generation, context = context, task = task, queue = null, ready = verification.matches(epoch))
    }

    private fun problem(error: Exception) {
        mutable.value = mutable.value.copy(ready = false, message = if (error is ApiError) error.message
            else "Nie udało się potwierdzić stanu. Sprawdź Wi-Fi i ponów odczyt lub zapis.")
    }
}
