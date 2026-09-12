package pl.wertis.kolektor.core.wms

import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import pl.wertis.kolektor.core.net.ApiError

@Serializable
data class WmsPending(
    val key: String,
    val context: WmsContext,
    val path: String,
    val body: JsonObject,
    val description: String,
    val runId: Long? = null,
)

@Serializable
data class WmsActive(val context: WmsContext, val runId: Long)

@Serializable
data class WmsJournal(val pending: WmsPending? = null, val active: WmsActive? = null)

interface WmsStore {
    suspend fun read(): WmsJournal
    suspend fun write(journal: WmsJournal)
}

interface WmsTransport {
    /** Zwraca numer uruchomionej trasy; null oznacza brak zamówień do zebrania. */
    suspend fun send(command: WmsPending): Long?
    suspend fun run(id: Long): WmsRun
}

data class WmsView(
    val generation: Long = 0,
    val context: WmsContext? = null,
    val journal: WmsJournal = WmsJournal(),
    val run: WmsRun? = null,
    val busy: Boolean = false,
    val ready: Boolean = false,
    val message: String? = null,
)

/** Jeden zapis naraz, na serwer i konto zapamiętane PRZED wysłaniem.
 * Awaria po zapisie na serwerze, także podczas kasowania dziennika, zostawia
 * ten sam klucz do ponowienia. Nie ma przycisku „pomiń nieznany wynik”. */
class WmsController(
    private val store: WmsStore,
    private val transport: (WmsContext) -> WmsTransport,
    private val newKey: () -> String = { UUID.randomUUID().toString() },
) {
    private val lock = Mutex()
    private var generation = 0L
    private val mutable = MutableStateFlow(WmsView())
    val state: StateFlow<WmsView> = mutable

    suspend fun open(context: WmsContext) = lock.withLock {
        mutable.value = WmsView(generation = ++generation, context = context, busy = true)
        try {
            val journal = store.read()
            mutable.value = mutable.value.copy(journal = journal)
            when {
                journal.pending != null -> mutable.value = mutable.value.copy(message =
                    if (journal.pending.context == context) "Sprawdź wynik ostatniego zapisu przed kolejnym skanem"
                    else "Niedokończony zapis innej osoby lub serwera. Wróć do poprzedniego konta i adresu serwera.")
                journal.active?.context == context -> load(context, journal.active.runId)
                else -> mutable.value = mutable.value.copy(ready = true)
            }
        } catch (e: CancellationException) { throw e }
        catch (e: Exception) { problem(e) }
        finally { mutable.value = mutable.value.copy(busy = false) }
    }

    suspend fun submit(context: WmsContext, draft: WmsDraft) {
        // Szybki drugi skan nie staje w kolejce z nieaktualną wersją zamówienia.
        if (!lock.tryLock()) return
        try {
            val view = mutable.value
            if (!view.ready || view.context != context || view.journal.pending != null) return
            mutable.value = view.copy(busy = true, ready = false, message = null)
            val pending = WmsPending(newKey(), context, draft.path, draft.body, draft.description, draft.runId)
            val journal = view.journal.copy(pending = pending)
            // Jeśli dysk odmawia zapisu, żądanie NIE wychodzi w sieć.
            store.write(journal)
            mutable.value = mutable.value.copy(journal = journal)
            send(context, pending)
        } catch (e: CancellationException) { throw e }
        catch (e: Exception) { problem(e) }
        finally { mutable.value = mutable.value.copy(busy = false); lock.unlock() }
    }

    suspend fun retry(context: WmsContext) {
        if (!lock.tryLock()) return
        try {
            val pending = mutable.value.journal.pending ?: return
            if (pending.context != context || mutable.value.context != context) return
            mutable.value = mutable.value.copy(busy = true, ready = false, message = null)
            send(context, pending)
        } catch (e: CancellationException) { throw e }
        catch (e: Exception) { problem(e) }
        finally { mutable.value = mutable.value.copy(busy = false); lock.unlock() }
    }

    suspend fun nextCart(context: WmsContext) = lock.withLock {
        val view = mutable.value
        if (view.context != context || !view.ready || view.journal.pending != null ||
            (view.run?.arrived_at == null && view.run?.closed_at == null)) return@withLock
        try {
            store.write(WmsJournal())
            mutable.value = WmsView(generation = ++generation, context = context, ready = true)
        } catch (e: Exception) { problem(e) }
    }

    private suspend fun send(context: WmsContext, pending: WmsPending) {
        val client = transport(context)
        val runId = try { client.send(pending) } catch (e: ApiError) {
            // Odmowa biznesowa jest atomowa. Brak autoryzacji, limit i błąd
            // infrastruktury nie dowodzą, że wcześniejsza próba nie doszła.
            if (e.status !in setOf(400, 404, 409, 422)) throw e
            val journal = mutable.value.journal.copy(pending = null)
            store.write(journal)
            mutable.value = mutable.value.copy(journal = journal, run = null)
            journal.active?.takeIf { it.context == context }?.let { load(context, it.runId) }
                ?: run { mutable.value = mutable.value.copy(ready = true) }
            mutable.value = mutable.value.copy(message = e.message)
            return
        }
        val journal = WmsJournal(active = runId?.let { WmsActive(context, it) })
        store.write(journal)
        mutable.value = mutable.value.copy(journal = journal, run = null)
        if (runId != null) load(context, runId, client)
        else mutable.value = mutable.value.copy(ready = true, message = "Brak zamówień do zebrania dla tego wózka")
    }

    private suspend fun load(context: WmsContext, id: Long, client: WmsTransport = transport(context)) {
        val run = client.run(id)
        require(run.id == id && run.picker_id == context.actorId) { "Trasa należy do innej osoby. Skontaktuj się z biurem." }
        mutable.value = mutable.value.copy(generation = ++generation, run = run, ready = true)
    }

    private fun problem(error: Exception) {
        mutable.value = mutable.value.copy(ready = false, message =
            if (error is ApiError) error.message else "Nie udało się potwierdzić stanu. Sprawdź Wi-Fi i ponów odczyt lub zapis.")
    }
}
