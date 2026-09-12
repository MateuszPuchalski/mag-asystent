package pl.wertis.kolektor.core.wms

import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import pl.wertis.kolektor.core.net.ApiError

interface WmsInboundTransport {
    suspend fun documents(query: String, offset: Int): WmsInboundList
    suspend fun receiveDocument(id: Long, query: String, offset: Int, lineId: Long?, barcode: String?): WmsInboundDocument
    suspend fun send(command: WmsPending)
}

data class WmsInboundView(
    val generation: Long = 0, val context: WmsContext? = null, val journal: WmsJournal = WmsJournal(),
    val documents: WmsInboundList? = null, val document: WmsInboundDocument? = null,
    val query: String = "", val offset: Int = 0, val buffer: Boolean = true,
    val confirmedBarcode: String? = null, val busy: Boolean = false, val ready: Boolean = false, val message: String? = null,
)

/** Liczenie korzysta z tego samego dziennika co zbiórka i odkładanie.
 * Skutek zapisu potwierdza świeża pozycja, bez pobierania całej dostawy. */
class WmsInboundController(
    private val store: WmsStore,
    private val transport: (WmsContext) -> WmsInboundTransport,
    private val lock: Mutex = Mutex(),
    private val newKey: () -> String = { UUID.randomUUID().toString() },
) {
    private var generation = 0L
    private val verification = WmsVerification()
    private val mutable = MutableStateFlow(WmsInboundView())
    val state: StateFlow<WmsInboundView> = mutable

    fun activateVerification() {
        verification.activate()
        mutable.value = mutable.value.copy(generation = ++generation, confirmedBarcode = null, ready = false)
    }
    fun invalidateVerification() {
        verification.invalidate()
        mutable.value = mutable.value.copy(generation = ++generation, confirmedBarcode = null, ready = false)
    }
    suspend fun open(context: WmsContext) = read(context, resume = true)
    suspend fun documents(context: WmsContext, query: String = "", offset: Int = 0) = read(context, query = query, offset = offset)
    suspend fun document(context: WmsContext, id: Long, query: String = "", offset: Int = 0, lineId: Long? = null) =
        read(context, inboundId = id, query = query, offset = offset, lineId = lineId)
    suspend fun scan(context: WmsContext, barcode: String) {
        val view = mutable.value
        if (view.context != context || !view.ready || view.busy) return
        val id = view.document?.document?.id ?: return
        read(context, inboundId = id, barcode = barcode.trim())
    }
    suspend fun setBuffer(context: WmsContext, buffer: Boolean) {
        val view = mutable.value
        if (view.context != context || !view.ready || view.busy) return
        read(context, inboundId = view.document?.document?.id ?: return, bufferMode = buffer)
    }

    private suspend fun read(context: WmsContext, resume: Boolean = false, inboundId: Long? = null,
        lineId: Long? = null, barcode: String? = null, query: String = "", offset: Int = 0, bufferMode: Boolean? = null, epoch: Long? = verification.capture()) = lock.withLock {
        if (!verification.matches(epoch)) return@withLock
        val previous = mutable.value
        mutable.value = WmsInboundView(generation = ++generation, context = context, busy = true, query = query, offset = offset)
        try {
            require(query.length <= 120 && offset in 0..1000000 && (barcode == null || barcode.length in 1..120)) { "Nieprawidłowy kod lub filtr" }
            val journal = store.read()
            mutable.value = mutable.value.copy(journal = journal)
            if (journal.pending != null) {
                mutable.value = mutable.value.copy(message = "Najpierw sprawdź wynik ostatniego zapisu WMS")
                return@withLock
            }
            val active = journal.receiving?.takeIf { it.context == context }
            val selected = if (resume) active?.inboundId else inboundId
            val selectedLine = if (resume) active?.lineId else lineId
            val buffer = bufferMode ?: active?.takeIf { it.inboundId == selected }?.buffer ?: true
            mutable.value = mutable.value.copy(buffer = buffer)
            val client = transport(context)
            if (selected == null) {
                val rows = client.documents(query, offset)
                val next = journal.copy(receiving = null)
                store.write(next)
                mutable.value = mutable.value.copy(journal = next, documents = rows, ready = verification.matches(epoch))
            } else {
                val result = client.receiveDocument(selected, query, offset, selectedLine, barcode)
                validate(result, selected, selectedLine)
                if (barcode != null) inboundProduct(requireNotNull(result.selected), barcode)
                val next = journal.copy(receiving = WmsActiveInbound(context, selected, result.selected?.id, buffer))
                store.write(next)
                mutable.value = mutable.value.copy(generation = ++generation, journal = next, document = result, ready = verification.matches(epoch),
                    confirmedBarcode = barcode.takeIf { verification.matches(epoch) })
            }
        } catch (e: CancellationException) { throw e }
        catch (e: Exception) {
            // Obcy lub wieloznaczny skan nie odbiera możliwości zeskanowania następnej części.
            if (barcode != null && previous.context == context && previous.document != null && previous.document.document.id == inboundId &&
                e is ApiError && e.status in setOf(404, 409) && mutable.value.journal.pending == null) {
                mutable.value = mutable.value.copy(document = previous.document.copy(selected = null), buffer = previous.buffer,
                    ready = verification.matches(epoch), message = e.message)
            } else problem(e)
        } finally { mutable.value = mutable.value.copy(busy = false) }
    }

    suspend fun submit(context: WmsContext, draft: WmsInboundDraft) {
        if (!lock.tryLock()) return
        try {
            val view = mutable.value
            if (view.context != context || !view.ready || view.busy || view.document?.document?.id != draft.inboundId ||
                (draft.lineId != null && view.document.selected?.id != draft.lineId)) return
            val epoch = verification.capture() ?: return
            val latest = store.read()
            if (!verification.matches(epoch)) return
            mutable.value = view.copy(journal = latest, ready = false, confirmedBarcode = null)
            if (latest.pending != null) {
                mutable.value = mutable.value.copy(message = "Najpierw rozlicz ostatni zapis WMS")
                return
            }
            mutable.value = mutable.value.copy(busy = true, message = null)
            val pending = WmsPending(newKey(), context, draft.path, draft.body, draft.description,
                workflow = "receiving", inboundId = draft.inboundId, lineId = draft.lineId)
            val next = latest.copy(pending = pending, receiving = WmsActiveInbound(context, draft.inboundId, draft.lineId, view.buffer))
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
            if (pending.context != context || pending.workflow != "receiving") return
            mutable.value = mutable.value.copy(busy = true, ready = false, confirmedBarcode = null, message = null,
                buffer = journal.receiving?.buffer ?: true)
            send(context, pending, epoch)
        } catch (e: CancellationException) { throw e }
        catch (e: Exception) { problem(e) }
        finally { mutable.value = mutable.value.copy(busy = false); lock.unlock() }
    }

    private suspend fun send(context: WmsContext, pending: WmsPending, epoch: Long?) {
        val id = requireNotNull(pending.inboundId) { "Brak numeru przyjęcia w dzienniku" }
        val client = transport(context)
        var rejection: String? = null
        try { client.send(pending) } catch (e: ApiError) {
            if (!definitiveWmsRejection(e)) throw e
            rejection = e.message
        }
        val next = mutable.value.journal.copy(pending = null)
        store.write(next)
        mutable.value = mutable.value.copy(journal = next)
        val result = client.receiveDocument(id, "", 0, pending.lineId, null)
        validate(result, id, pending.lineId)
        mutable.value = mutable.value.copy(generation = ++generation, document = result, ready = verification.matches(epoch), confirmedBarcode = null, message = rejection)
    }

    private fun validate(result: WmsInboundDocument, id: Long, lineId: Long?) {
        require(result.document.id == id && result.document.version > 0 && result.summary.remaining >= 0 &&
            (lineId == null || result.selected?.id == lineId) &&
            (result.selected == null || result.selected.inbound_id == id)) { "Nieznana odpowiedź przyjęcia" }
    }
    private fun problem(error: Exception) {
        mutable.value = mutable.value.copy(ready = false, confirmedBarcode = null, message = if (error is ApiError) error.message
            else "Nie udało się potwierdzić stanu. Sprawdź Wi-Fi i ponów odczyt lub zapis.")
    }
}
