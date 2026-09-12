package pl.wertis.kolektor.core.wms

import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import pl.wertis.kolektor.core.net.ApiError

interface WmsCountTransport {
    suspend fun queue(query: String, offset: Int): WmsCountQueue
    suspend fun countingTask(id: Long): WmsCountTask
    suspend fun send(command: WmsPending)
}

data class WmsCountView(
    val generation: Long = 0, val context: WmsContext? = null, val journal: WmsJournal = WmsJournal(),
    val task: WmsCountTask? = null, val queue: WmsCountQueue? = null,
    val query: String = "", val offset: Int = 0, val busy: Boolean = false, val ready: Boolean = false,
    val message: String? = null,
)

/** Wspólny dziennik chroni wynik liczenia przed przykryciem kolejną pracą.
 * Powrót na ekran wymaga świeżego stanu i nowych skanów półki oraz części. */
class WmsCountController(
    private val store: WmsStore,
    private val transport: (WmsContext) -> WmsCountTransport,
    private val lock: Mutex = Mutex(),
    private val newKey: () -> String = { UUID.randomUUID().toString() },
) {
    private var generation = 0L
    private var visible = true
    private val mutable = MutableStateFlow(WmsCountView())
    val state: StateFlow<WmsCountView> = mutable

    fun invalidateVerification() {
        visible = false
        mutable.value = mutable.value.copy(generation = ++generation, ready = false)
    }

    suspend fun open(context: WmsContext) = read(context, resume = true)
    suspend fun select(context: WmsContext, id: Long) = read(context, taskId = id)
    suspend fun queue(context: WmsContext, query: String = "", offset: Int = 0) = read(context, query = query, offset = offset)

    private suspend fun read(context: WmsContext, resume: Boolean = false, taskId: Long? = null, query: String = "", offset: Int = 0) = lock.withLock {
        visible = true
        mutable.value = WmsCountView(generation = ++generation, context = context, busy = true, query = query, offset = offset)
        try {
            require(query.length <= 120 && offset in 0..1000000) { "Zbyt długi filtr kolejki" }
            val journal = store.read()
            mutable.value = mutable.value.copy(journal = journal)
            if (journal.pending != null) {
                mutable.value = mutable.value.copy(message = "Najpierw sprawdź wynik ostatniego zapisu WMS")
                return@withLock
            }
            val selected = if (resume) journal.counting?.takeIf { it.context == context }?.taskId else taskId
            val client = transport(context)
            if (selected != null) {
                load(context, selected, client)
                val next = journal.copy(counting = WmsActiveCount(context, selected))
                store.write(next)
                mutable.value = mutable.value.copy(journal = next)
            } else {
                val queue = client.queue(query, offset)
                val next = journal.copy(counting = null)
                store.write(next)
                mutable.value = mutable.value.copy(journal = next, queue = queue, ready = visible)
            }
        } catch (e: CancellationException) { throw e }
        catch (e: Exception) { problem(e) }
        finally { mutable.value = mutable.value.copy(busy = false) }
    }

    suspend fun submit(context: WmsContext, draft: WmsCountDraft) {
        if (!lock.tryLock()) return
        try {
            val view = mutable.value
            if (view.context != context || !view.ready || view.busy || view.task?.id != draft.taskId) return
            val latest = store.read()
            mutable.value = view.copy(journal = latest, ready = false)
            if (latest.pending != null) {
                mutable.value = mutable.value.copy(message = "Najpierw rozlicz ostatni zapis WMS")
                return
            }
            mutable.value = mutable.value.copy(busy = true, message = null)
            val pending = WmsPending(newKey(), context, draft.path, draft.body, draft.description, workflow = "counting", taskId = draft.taskId)
            val next = latest.copy(pending = pending, counting = WmsActiveCount(context, draft.taskId))
            store.write(next)
            mutable.value = mutable.value.copy(journal = next)
            send(context, pending)
        } catch (e: CancellationException) { throw e }
        catch (e: Exception) { problem(e) }
        finally { mutable.value = mutable.value.copy(busy = false); lock.unlock() }
    }

    suspend fun retry(context: WmsContext) {
        if (!lock.tryLock()) return
        try {
            if (mutable.value.context != context) return
            val journal = store.read()
            mutable.value = mutable.value.copy(journal = journal)
            val pending = journal.pending ?: return
            if (pending.context != context || pending.workflow != "counting") return
            mutable.value = mutable.value.copy(busy = true, ready = false, message = null)
            send(context, pending)
        } catch (e: CancellationException) { throw e }
        catch (e: Exception) { problem(e) }
        finally { mutable.value = mutable.value.copy(busy = false); lock.unlock() }
    }

    private suspend fun send(context: WmsContext, pending: WmsPending) {
        val client = transport(context)
        val id = requireNotNull(pending.taskId) { "Brak numeru zadania w dzienniku" }
        var rejection: String? = null
        try { client.send(pending) } catch (e: ApiError) {
            if (!definitiveWmsRejection(e)) throw e
            rejection = e.message
        }
        val journal = mutable.value.journal.copy(pending = null, counting = WmsActiveCount(context, id))
        store.write(journal)
        mutable.value = mutable.value.copy(journal = journal)
        load(context, id, client)
        mutable.value = mutable.value.copy(message = rejection)
    }

    private suspend fun load(context: WmsContext, id: Long, client: WmsCountTransport) {
        val task = client.countingTask(id)
        require(task.id == id && task.version > 0) { "Nieznana odpowiedź zadania" }
        mutable.value = mutable.value.copy(generation = ++generation, context = context, task = task, queue = null, ready = visible)
    }

    private fun problem(error: Exception) {
        mutable.value = mutable.value.copy(ready = false, message = if (error is ApiError) error.message
            else "Nie udało się potwierdzić stanu. Sprawdź Wi-Fi i ponów odczyt lub zapis.")
    }
}
