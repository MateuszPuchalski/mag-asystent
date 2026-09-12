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
    val workflow: String = "picking",
    val taskId: Long? = null,
    val inboundId: Long? = null,
    val lineId: Long? = null,
)

@Serializable
data class WmsActive(val context: WmsContext, val runId: Long)

@Serializable
data class WmsActivePutaway(val context: WmsContext, val taskId: Long)

@Serializable
data class WmsActiveInbound(val context: WmsContext, val inboundId: Long, val lineId: Long? = null, val buffer: Boolean = true)

@Serializable
data class WmsActiveCount(val context: WmsContext, val taskId: Long)

@Serializable
data class WmsJournal(val pending: WmsPending? = null, val active: WmsActive? = null, val putaway: WmsActivePutaway? = null, val receiving: WmsActiveInbound? = null, val counting: WmsActiveCount? = null)

fun definitiveWmsRejection(error: ApiError): Boolean = error.status in setOf(400, 404, 409, 422) ||
    (error.status == 403 && error.kod == "WMS_COMMAND_REJECTED")

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
    val initialScan: WmsScanState? = null,
    val context: WmsContext? = null,
    val journal: WmsJournal = WmsJournal(),
    val run: WmsRun? = null,
    val busy: Boolean = false,
    val ready: Boolean = false,
    val reassigned: Boolean = false,
    val message: String? = null,
)

/** Jeden zapis naraz, na serwer i konto zapamiętane PRZED wysłaniem.
 * Awaria po zapisie na serwerze, także podczas kasowania dziennika, zostawia
 * ten sam klucz do ponowienia. Nie ma przycisku „pomiń nieznany wynik”. */
class WmsController(
    private val store: WmsStore,
    private val transport: (WmsContext) -> WmsTransport,
    private val newKey: () -> String = { UUID.randomUUID().toString() },
    private val lock: Mutex = Mutex(),
) {
    private var generation = 0L
    private val verification = WmsVerification()
    private val mutable = MutableStateFlow(WmsView())
    val state: StateFlow<WmsView> = mutable

    fun activateVerification() {
        verification.activate()
        mutable.value = mutable.value.copy(generation = ++generation, initialScan = null, ready = false)
    }
    fun invalidateVerification() {
        verification.invalidate()
        mutable.value = mutable.value.copy(generation = ++generation, initialScan = null, ready = false)
    }

    suspend fun open(context: WmsContext) = read(context, verification.capture())

    private suspend fun read(context: WmsContext, epoch: Long?) = lock.withLock {
        if (!verification.matches(epoch)) return@withLock
        mutable.value = WmsView(generation = ++generation, context = context, busy = true)
        try {
            val journal = store.read()
            mutable.value = mutable.value.copy(journal = journal)
            when {
                journal.pending != null -> mutable.value = mutable.value.copy(message =
                    if (journal.pending.context == context) "Sprawdź wynik ostatniego zapisu przed kolejnym skanem"
                    else "Niedokończony zapis innej osoby lub serwera. Wróć do poprzedniego konta i adresu serwera.")
                journal.active?.context == context -> load(context, journal.active.runId, epoch = epoch)
                else -> mutable.value = mutable.value.copy(ready = verification.matches(epoch))
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
            // Inny proces WMS mógł zostawić zapis od ostatniego wejścia na ekran.
            val epoch = verification.capture() ?: return
            val latest = store.read()
            if (!verification.matches(epoch)) return
            if (latest.pending != null) {
                mutable.value = view.copy(journal = latest, ready = false, message = "Najpierw rozlicz ostatni zapis WMS")
                return
            }
            mutable.value = view.copy(busy = true, ready = false, message = null)
            val pending = WmsPending(newKey(), context, draft.path, draft.body, draft.description, draft.runId)
            val journal = latest.copy(pending = pending)
            // Jeśli dysk odmawia zapisu, żądanie NIE wychodzi w sieć.
            store.write(journal)
            mutable.value = mutable.value.copy(journal = journal)
            send(context, pending, epoch, continuationEpoch = epoch)
        } catch (e: CancellationException) { throw e }
        catch (e: Exception) { problem(e) }
        finally { mutable.value = mutable.value.copy(busy = false); lock.unlock() }
    }

    suspend fun retry(context: WmsContext) {
        if (!lock.tryLock()) return
        try {
            val epoch = verification.capture() ?: return
            val latest = store.read()
            if (!verification.matches(epoch)) return
            mutable.value = mutable.value.copy(journal = latest)
            val pending = latest.pending ?: return
            if (pending.workflow != "picking") return
            if (pending.context != context || mutable.value.context != context) return
            mutable.value = mutable.value.copy(busy = true, ready = false, message = null)
            send(context, pending, epoch, continuationEpoch = null)
        } catch (e: CancellationException) { throw e }
        catch (e: Exception) { problem(e) }
        finally { mutable.value = mutable.value.copy(busy = false); lock.unlock() }
    }

    suspend fun nextCart(context: WmsContext) = clearCart(context, verification.capture())

    private suspend fun clearCart(context: WmsContext, epoch: Long?) = lock.withLock {
        if (!verification.matches(epoch)) return@withLock
        val view = mutable.value
        if (view.context != context || view.busy || view.journal.pending != null ||
            (!view.reassigned && (!view.ready || (view.run?.arrived_at == null && view.run?.closed_at == null)))) return@withLock
        try {
            val latest = store.read()
            if (!verification.matches(epoch)) return@withLock
            if (latest.pending != null) {
                mutable.value = view.copy(journal = latest, ready = false)
                return@withLock
            }
            val journal = latest.copy(active = null)
            store.write(journal)
            mutable.value = WmsView(generation = ++generation, context = context, journal = journal, ready = verification.matches(epoch))
        } catch (e: CancellationException) { throw e }
        catch (e: Exception) { problem(e) }
    }

    private suspend fun send(context: WmsContext, pending: WmsPending, epoch: Long?, continuationEpoch: Long?) {
        val before = mutable.value.run
        val client = transport(context)
        val runId = try { client.send(pending) } catch (e: ApiError) {
            // Odmowa biznesowa jest atomowa. Brak autoryzacji, limit i błąd
            // infrastruktury nie dowodzą, że wcześniejsza próba nie doszła.
            if (!definitiveWmsRejection(e)) throw e
            val journal = mutable.value.journal.copy(pending = null)
            store.write(journal)
            mutable.value = mutable.value.copy(journal = journal, run = null)
            journal.active?.takeIf { it.context == context }?.let { load(context, it.runId, epoch = epoch) }
                ?: run { mutable.value = mutable.value.copy(ready = verification.matches(epoch)) }
            mutable.value = mutable.value.copy(message = mutable.value.message ?: e.message)
            return
        }
        val journal = mutable.value.journal.copy(pending = null, active = runId?.let { WmsActive(context, it) })
        store.write(journal)
        mutable.value = mutable.value.copy(journal = journal)
        if (runId != null) load(context, runId, client, epoch) { after ->
            if (verification.matches(continuationEpoch)) continueWmsStop(before, after, pending) else null
        }
        else mutable.value = mutable.value.copy(ready = verification.matches(epoch), message = "Brak zamówień do zebrania dla tego wózka")
    }

    private suspend fun load(
        context: WmsContext,
        id: Long,
        client: WmsTransport = transport(context),
        epoch: Long?,
        continuation: ((WmsRun) -> WmsScanState?)? = null,
    ) {
        val run = try { client.run(id) } catch (e: ApiError) {
            if (e.status != 403 || e.kod != "WMS_RUN_REASSIGNED") throw e
            reassigned()
            return
        }
        require(run.id == id) { "Serwer zwrócił inną trasę" }
        if (run.picker_id != context.actorId) { reassigned(); return }
        mutable.value = mutable.value.copy(generation = ++generation, initialScan = continuation?.invoke(run), run = run, ready = verification.matches(epoch))
    }

    private fun reassigned() {
        mutable.value = mutable.value.copy(generation = ++generation, initialScan = null, run = null,
            ready = false, reassigned = true, message = "Trasę przejęła inna osoba. Przekaż jej wózek i rozpocznij kolejny.")
    }

    private fun problem(error: Exception) {
        mutable.value = mutable.value.copy(initialScan = null, ready = false, message =
            if (error is ApiError) error.message else "Nie udało się potwierdzić stanu. Sprawdź Wi-Fi i ponów odczyt lub zapis.")
    }
}
