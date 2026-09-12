package pl.wertis.kolektor.core.wms

import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import pl.wertis.kolektor.core.net.ApiError

interface WmsPutawayTransport {
    suspend fun queue(query: String, offset: Int): WmsPutawayQueue
    suspend fun putawayTask(id: Long): WmsPutawayTask
    suspend fun send(command: WmsPending)
}

data class WmsPutawayView(
    val generation: Long = 0, val context: WmsContext? = null, val journal: WmsJournal = WmsJournal(),
    val task: WmsPutawayTask? = null, val queue: WmsPutawayQueue? = null,
    val query: String = "", val offset: Int = 0, val busy: Boolean = false, val ready: Boolean = false,
    val message: String? = null,
)

/** Wspólny dziennik i blokada nie pozwalają przykryć nieznanej zbiórki odkładaniem.
 * Każdy powrót i potwierdzony ruch wymagają świeżego odczytu oraz nowych skanów. */
class WmsPutawayController(
    private val store: WmsStore,
    private val transport: (WmsContext) -> WmsPutawayTransport,
    private val lock: Mutex = Mutex(),
    private val newKey: () -> String = { UUID.randomUUID().toString() },
) {
    private var generation = 0L
    private val verification = WmsVerification()
    private val mutable = MutableStateFlow(WmsPutawayView())
    val state: StateFlow<WmsPutawayView> = mutable

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
        mutable.value = WmsPutawayView(generation = ++generation, context = context, busy = true, query = query, offset = offset)
        try {
            require(query.length <= 120 && offset in 0..1000000) { "Zbyt długi filtr kolejki" }
            val journal = store.read()
            mutable.value = mutable.value.copy(journal = journal)
            if (journal.pending != null) {
                mutable.value = mutable.value.copy(message = "Najpierw sprawdź wynik ostatniego zapisu WMS")
                return@withLock
            }
            val selected = if (resume) journal.putaway?.takeIf { it.context == context }?.taskId else taskId
            val client = transport(context)
            if (selected != null) {
                load(context, selected, client, epoch)
                val next = journal.copy(putaway = WmsActivePutaway(context, selected))
                store.write(next)
                mutable.value = mutable.value.copy(journal = next)
            } else {
                val queue = client.queue(query, offset)
                val next = journal.copy(putaway = null)
                store.write(next)
                mutable.value = mutable.value.copy(journal = next, queue = queue, ready = verification.matches(epoch))
            }
        } catch (e: CancellationException) { throw e }
        catch (e: Exception) { problem(e) }
        finally { mutable.value = mutable.value.copy(busy = false) }
    }

    suspend fun submit(context: WmsContext, draft: WmsPutawayDraft) {
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
            val pending = WmsPending(newKey(), context, draft.path, draft.body, draft.description, workflow = "putaway", taskId = draft.taskId)
            val next = latest.copy(pending = pending, putaway = WmsActivePutaway(context, draft.taskId))
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
            if (pending.context != context || pending.workflow != "putaway") return
            mutable.value = mutable.value.copy(busy = true, ready = false, message = null)
            send(context, pending, epoch)
        } catch (e: CancellationException) { throw e }
        catch (e: Exception) { problem(e) }
        finally { mutable.value = mutable.value.copy(busy = false); lock.unlock() }
    }

    private suspend fun send(context: WmsContext, pending: WmsPending, epoch: Long?) {
        val client = transport(context)
        val id = requireNotNull(pending.taskId) { "Brak numeru zadania w dzienniku" }
        var rejection: String? = null
        try { client.send(pending) } catch (e: ApiError) {
            if (!definitiveWmsRejection(e)) throw e
            rejection = e.message
        }
        val journal = mutable.value.journal.copy(pending = null, putaway = WmsActivePutaway(context, id))
        store.write(journal)
        mutable.value = mutable.value.copy(journal = journal)
        load(context, id, client, epoch)
        mutable.value = mutable.value.copy(message = rejection)
    }

    private suspend fun load(context: WmsContext, id: Long, client: WmsPutawayTransport, epoch: Long?) {
        val task = client.putawayTask(id)
        require(task.id == id && task.remaining >= 0 && task.version > 0) { "Nieznana odpowiedź zadania" }
        mutable.value = mutable.value.copy(generation = ++generation, context = context, task = task, queue = null, ready = verification.matches(epoch))
    }

    private fun problem(error: Exception) {
        mutable.value = mutable.value.copy(ready = false, message = if (error is ApiError) error.message
            else "Nie udało się potwierdzić stanu. Sprawdź Wi-Fi i ponów odczyt lub zapis.")
    }
}
