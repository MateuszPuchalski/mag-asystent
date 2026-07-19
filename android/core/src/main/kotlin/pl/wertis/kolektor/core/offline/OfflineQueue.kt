package pl.wertis.kolektor.core.offline

import java.util.concurrent.atomic.AtomicLong
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.serialization.Serializable
import pl.wertis.kolektor.core.net.ApiError
import pl.wertis.kolektor.core.net.MmBody
import pl.wertis.kolektor.core.net.SetLocationBody

/* ── Bufor operacji zapisu na czas braku sieci ──────────────────────────────
   Port web/src/lib/offline.ts. Kolektor gubi Wi-Fi przy metalowych regałach —
   zamiast tracić skan, buforujemy operację (zmiana lokalizacji / MM) i wysyłamy
   po odzyskaniu połączenia. Serwer i tak kolejkuje przez worker Sfery, więc
   bufor to tylko warstwa transportu.

   Niezmiennik: błędy serwera (ApiError) NIE są buforowane — propagują do UI
   (np. walidacja). Buforujemy wyłącznie awarie sieci (każdy inny wyjątek).   */

@Serializable
data class PendingOp(
    val id: String,
    val kind: OpKind,
    val productId: Long? = null,
    val setLocation: SetLocationBody? = null,
    val mm: MmBody? = null,
    val at: Long,
    /** Autor z chwili zbuforowania — flush może nastąpić po zmianie użytkownika. */
    val user: String,
) {
    @Serializable
    enum class OpKind { SET_LOCATION, MM }
}

/** Trwały zapis bufora (aplikacja: plik JSON — odpowiednik localStorage). */
interface OpStorage {
    fun load(): List<PendingOp>
    fun save(ops: List<PendingOp>)
}

/** Wysyłka operacji na serwer. Rzuca ApiError przy odrzuceniu, inne wyjątki = sieć. */
fun interface OpSender {
    /** @return queueId zadania w kolejce Sfery (do COFNIJ), gdy serwer go zwraca. */
    suspend fun send(op: PendingOp): Long?
}

data class RunResult(
    val offline: Boolean,
    /** id zadania w kolejce Sfery (online) — do COFNIJ. */
    val queueId: Long? = null,
    /** id operacji w buforze (offline) — do COFNIJ. */
    val bufferId: String? = null,
)

class OfflineQueue(
    private val storage: OpStorage,
    private val sender: OpSender,
    private val isOnline: () -> Boolean,
    /** Serwer odrzucił operację z bufora (np. zła ilość) — zgłoś, nie blokuj kolejki. */
    private val onRejected: (PendingOp, String) -> Unit = { _, _ -> },
    private val now: () -> Long = System::currentTimeMillis,
) {
    private val lock = Any()
    private var ops: List<PendingOp> = storage.load()
    private val counter = AtomicLong(0)
    private val flushMutex = Mutex()

    private val _count = MutableStateFlow(ops.size)
    val count: StateFlow<Int> = _count

    private fun persist(next: List<PendingOp>) {
        synchronized(lock) {
            ops = next
            storage.save(next)
            _count.value = next.size
        }
    }

    private fun nextId(): String = "${now()}-${counter.incrementAndGet()}"

    /** Czy błąd to awaria sieci (a nie odpowiedź serwera 4xx/5xx). */
    private fun isNetworkError(e: Exception): Boolean = e !is ApiError

    /**
     * Wykonaj operację online; przy braku sieci — zbuforuj i zwróć znacznik offline.
     * Błędy serwera (ApiError) NIE są buforowane — propagują do wywołującego.
     */
    suspend fun runOrBuffer(
        kind: PendingOp.OpKind,
        user: String,
        productId: Long? = null,
        setLocation: SetLocationBody? = null,
        mm: MmBody? = null,
    ): RunResult {
        val op = PendingOp(nextId(), kind, productId, setLocation, mm, at = now(), user = user)
        if (isOnline()) {
            try {
                return RunResult(offline = false, queueId = sender.send(op))
            } catch (e: Exception) {
                if (!isNetworkError(e)) throw e // realny błąd serwera → do UI
            }
        }
        persist(ops + op)
        return RunResult(offline = true, bufferId = op.id)
    }

    /** Usuń operację z bufora (COFNIJ przed wysłaniem). Zwraca czy istniała. */
    fun remove(bufferId: String): Boolean {
        val next = ops.filter { it.id != bufferId }
        val removed = next.size != ops.size
        if (removed) persist(next)
        return removed
    }

    /** Spróbuj wysłać całą kolejkę. Przy awarii sieci — przerwij i zostaw resztę. */
    suspend fun flush() {
        if (!flushMutex.tryLock()) return
        try {
            if (!isOnline()) return
            while (ops.isNotEmpty()) {
                val op = ops.first()
                try {
                    sender.send(op)
                    persist(ops.drop(1))
                } catch (e: Exception) {
                    if (isNetworkError(e)) break // nadal offline — spróbujemy później
                    persist(ops.drop(1))
                    onRejected(op, e.message ?: "błąd")
                }
            }
        } finally {
            flushMutex.unlock()
        }
    }
}
