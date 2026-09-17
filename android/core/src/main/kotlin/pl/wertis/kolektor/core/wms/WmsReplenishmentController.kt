package pl.wertis.kolektor.core.wms

import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import pl.wertis.kolektor.core.net.ApiError

interface WmsReplenishmentTransport {
    suspend fun queue(view: String, query: String, offset: Int): WmsReplenishmentQueue
    suspend fun replenishingTask(id: Long): WmsReplenishmentTask
    suspend fun send(command: WmsPending): Long
}

data class WmsReplenishmentView(
    val generation: Long = 0, val context: WmsContext? = null, val journal: WmsJournal = WmsJournal(),
    val task: WmsReplenishmentTask? = null, val queue: WmsReplenishmentQueue? = null,
    val query: String = "", val offset: Int = 0, val mode: String = "tasks", val busy: Boolean = false, val ready: Boolean = false,
    val message: String? = null,
)

/** Wspólny dziennik chroni wynik uzupełnienia przed przykryciem kolejną pracą.
 * Powrót wymaga świeżego stanu i skanów; utracone podjęcie odzyskuje także numer zadania. */
class WmsReplenishmentController(
    private val store: WmsStore,
    private val transport: (WmsContext) -> WmsReplenishmentTransport,
    private val lock: Mutex = Mutex(),
    private val newKey: () -> String = { UUID.randomUUID().toString() },
) {
    private var generation = 0L
    private val verification = WmsVerification()
    private val mutable = MutableStateFlow(WmsReplenishmentView())
    val state: StateFlow<WmsReplenishmentView> = mutable

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
    suspend fun queue(context: WmsContext, mode: String = "tasks", query: String = "", offset: Int = 0) = read(context, mode = mode, query = query, offset = offset)

    private suspend fun read(context: WmsContext, resume: Boolean = false, taskId: Long? = null, query: String = "", offset: Int = 0, mode: String = "tasks", epoch: Long? = verification.capture()) = lock.withLock {
        if (!verification.matches(epoch)) return@withLock
        mutable.value = WmsReplenishmentView(generation = ++generation, context = context, busy = true, query = query, offset = offset, mode = mode)
        try {
            require(query.length <= 120 && offset in 0..1000000 && mode in setOf("tasks", "plans")) { "Zbyt długi filtr kolejki" }
            val journal = store.read()
            mutable.value = mutable.value.copy(journal = journal)
            if (journal.pending != null) {
                mutable.value = mutable.value.copy(message = "Najpierw sprawdź wynik ostatniego zapisu WMS")
                return@withLock
            }
            val selected = if (resume) journal.replenishing?.takeIf { it.context == context }?.taskId else taskId
            val client = transport(context)
            if (selected != null) {
                load(context, selected, client, epoch)
                val next = journal.copy(replenishing = WmsActiveReplenishment(context, selected))
                store.write(next)
                mutable.value = mutable.value.copy(journal = next)
            } else {
                val queue = client.queue(mode, query, offset)
                val next = journal.copy(replenishing = null)
                store.write(next)
                mutable.value = mutable.value.copy(journal = next, queue = queue, ready = verification.matches(epoch))
            }
        } catch (e: CancellationException) { throw e }
        catch (e: Exception) { problem(e) }
        finally { mutable.value = mutable.value.copy(busy = false) }
    }

    suspend fun submit(context: WmsContext, draft: WmsReplenishmentDraft) {
        if (!lock.tryLock()) return
        try {
            val view = mutable.value
            if (view.context != context || !view.ready || view.busy || view.task?.id != draft.taskId || (draft.taskId == null && view.queue?.view != "plans")) return
            val epoch = verification.capture() ?: return
            val latest = store.read()
            if (!verification.matches(epoch)) return
            mutable.value = view.copy(journal = latest, ready = false)
            if (latest.pending != null) {
                mutable.value = mutable.value.copy(message = "Najpierw rozlicz ostatni zapis WMS")
                return
            }
            mutable.value = mutable.value.copy(busy = true, message = null)
            val pending = WmsPending(newKey(), context, draft.path, draft.body, draft.description, workflow = "replenishment", taskId = draft.taskId)
            val next = latest.copy(pending = pending, replenishing = draft.taskId?.let { WmsActiveReplenishment(context, it) })
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
            if (pending.context != context || pending.workflow != "replenishment") return
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
        if (id != null) require(id > 0 && (pending.taskId == null || pending.taskId == id)) { "Nieznana odpowiedź uzupełnienia" }
        val journal = mutable.value.journal.copy(pending = null, replenishing = id?.let { WmsActiveReplenishment(context, it) })
        store.write(journal)
        mutable.value = mutable.value.copy(journal = journal)
        if (id != null) load(context, id, client, epoch) else {
            val queue = client.queue("plans", "", 0)
            mutable.value = mutable.value.copy(generation = ++generation, queue = queue, task = null, mode = "plans", query = "", offset = 0, ready = verification.matches(epoch))
        }
        mutable.value = mutable.value.copy(message = rejection)
    }

    private suspend fun load(context: WmsContext, id: Long, client: WmsReplenishmentTransport, epoch: Long?) {
        val task = client.replenishingTask(id)
        require(task.id == id && task.quantity > 0) { "Nieznana odpowiedź zadania" }
        mutable.value = mutable.value.copy(generation = ++generation, context = context, task = task, queue = null, ready = verification.matches(epoch))
    }

    private fun problem(error: Exception) {
        mutable.value = mutable.value.copy(ready = false, message = if (error is ApiError) error.message
            else "Nie udało się potwierdzić stanu. Sprawdź Wi-Fi i ponów odczyt lub zapis.")
    }
}
