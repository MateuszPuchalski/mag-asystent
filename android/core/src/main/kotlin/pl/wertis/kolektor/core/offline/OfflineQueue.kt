package pl.wertis.kolektor.core.offline

import java.util.concurrent.atomic.AtomicLong
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.serialization.Serializable
import pl.wertis.kolektor.core.net.ApiError
import pl.wertis.kolektor.core.net.PutawayLineBody
import pl.wertis.kolektor.core.net.SetLocationBody

/* ── Bufor operacji zapisu na czas braku sieci ──────────────────────────────
   Port web/src/lib/offline.ts. Kolektor gubi Wi-Fi przy metalowych regałach —
   zamiast tracić skan, buforujemy operację (zmiana lokalizacji) i wysyłamy
   po odzyskaniu połączenia. Serwer i tak kolejkuje przez worker Sfery, więc
   bufor to tylko warstwa transportu.

   Niezmiennik: błędy serwera (ApiError) NIE są buforowane — propagują do UI
   (np. walidacja). Buforujemy wyłącznie awarie sieci (każdy inny wyjątek).   */

/**
 * Odłożenie pozycji dostawy do wysłania po powrocie sieci.
 *
 * Rozkładanie to najdłuższa nieprzerwana praca na kolektorze i dzieje się
 * także w martwych punktach hali — dziura Wi-Fi nie może wyrzucać człowieka
 * z rytmu ani gubić policzonej pozycji.
 */
@Serializable
data class PutawayOp(
    val deliveryId: Long,
    val lineId: Long,
    val body: PutawayLineBody,
)

@Serializable
data class PendingOp(
    val id: String,
    val kind: OpKind,
    val productId: Long? = null,
    val setLocation: SetLocationBody? = null,
    val putaway: PutawayOp? = null,
    val at: Long,
    /** Autor z chwili zbuforowania — flush może nastąpić po zmianie użytkownika. */
    val user: String,
    /**
     * KONTO autora z chwili zbuforowania.
     *
     * Sama nazwa nie wystarcza: serwer rozstrzyga tożsamość z tokenu sesji,
     * a token przy wysyłce należy już do osoby, która akurat trzyma kolektor.
     * Bez tego pola dwanaście pozycji odłożonych przez Jana poza zasięgiem
     * dostałoby w audycie nazwisko Piotra, który przejął pracę, zanim wróciło
     * Wi-Fi. `null` dla operacji zbuforowanych przed wprowadzeniem kont.
     */
    val userRef: Long? = null,
    /**
     * Ile razy serwer odrzucił tę operację błędem PRZEJŚCIOWYM.
     *
     * Bez licznika serwer zwracający 500 bez końca zamroziłby bufor na zawsze:
     * pierwsza operacja wracałaby do kolejki w nieskończoność, a wszystko za
     * nią nigdy by nie ruszyło. Po `MAX_PROB` traktujemy ją jak trwale
     * odrzuconą — z meldunkiem, nie po cichu.
     */
    val proby: Int = 0,
) {
    @Serializable
    enum class OpKind { SET_LOCATION, PUTAWAY }
}

/** Trwały zapis bufora (aplikacja: plik JSON — odpowiednik localStorage). */
interface OpStorage {
    fun load(): List<PendingOp>
    fun save(ops: List<PendingOp>)
}

/** Wysyłka operacji na serwer. Rzuca ApiError przy odrzuceniu, inne wyjątki = sieć. */
fun interface OpSender {
    /** @return queueId zadania w kolejce Sfery, gdy serwer go zwraca. */
    suspend fun send(op: PendingOp): Long?
}

/**
 * Meldunek o operacji, której NIE DAŁO SIĘ wykonać.
 *
 * Bufor to plik na kolektorze — urządzenie zginie albo zostanie zresetowane,
 * więc operacja odrzucona i skasowana lokalnie przestaje istnieć. Serwer musi
 * się o niej dowiedzieć, choćby po to, żeby ktoś mógł powiedzieć magazynierowi,
 * co się stało z jego skanem.
 */
fun interface OpReporter {
    fun report(op: PendingOp, e: ApiError)
}

data class RunResult(
    val offline: Boolean,
    /** id zadania w kolejce Sfery (online); null gdy poszło do bufora. */
    val queueId: Long? = null,
)

class OfflineQueue(
    private val storage: OpStorage,
    private val sender: OpSender,
    private val isOnline: () -> Boolean,
    /** Serwer odrzucił operację z bufora (np. zła ilość) — zgłoś, nie blokuj kolejki. */
    private val onRejected: (PendingOp, String) -> Unit = { _, _ -> },
    /** Meldunek na serwer o operacji trwale odrzuconej — patrz `OpReporter`. */
    private val reporter: OpReporter = OpReporter { _, _ -> },
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
     * Czy odpowiedź serwera znaczy „spróbuj jeszcze raz", czy „to się nigdy nie
     * uda".
     *
     * Do sierpnia 2026 tego rozróżnienia NIE BYŁO: `flush()` traktował każdy
     * `ApiError` jednakowo i kasował operację z bufora. Przejściowy 500 przy
     * restarcie serwera albo 503 spod reverse proxy kasował więc zeskanowaną
     * pracę magazyniera — bez śladu, bez ostrzeżenia i bez szansy na powtórkę.
     *
     * 5xx to awaria SERWERA, a operacja jest zdrowa. 408 i 429 to wprost
     * „ponów". Reszta 4xx mówi, że żądanie jest wadliwe — i żadna liczba
     * ponowień tego nie naprawi.
     */
    private fun czyPrzejsciowy(e: ApiError): Boolean =
        e.status >= 500 || e.status == 408 || e.status == 429 || e.status == 0

    /**
     * Wykonaj operację online; przy braku sieci — zbuforuj i zwróć znacznik offline.
     * Błędy serwera (ApiError) NIE są buforowane — propagują do wywołującego.
     */
    suspend fun runOrBuffer(
        kind: PendingOp.OpKind,
        user: String,
        productId: Long? = null,
        setLocation: SetLocationBody? = null,
        putaway: PutawayOp? = null,
        /** Konto autora — patrz `PendingOp.userRef`. Na końcu, żeby nie ruszać
            wywołań pozycyjnych. */
        userRef: Long? = null,
    ): RunResult {
        val op = PendingOp(
            nextId(), kind, productId, setLocation, putaway, at = now(), user = user, userRef = userRef,
        )
        if (isOnline()) {
            try {
                return RunResult(offline = false, queueId = sender.send(op))
            } catch (e: Exception) {
                if (!isNetworkError(e)) throw e // realny błąd serwera → do UI
            }
        }
        persist(ops + op)
        return RunResult(offline = true)
    }

    /**
     * Spróbuj wysłać całą kolejkę.
     *
     * Trzy zakończenia, nie dwa:
     *  - brak sieci albo błąd PRZEJŚCIOWY → przerwij, operacja ZOSTAJE w buforze,
     *  - błąd TRWAŁY (4xx) → operacja wypada, ale zostaje ZAMELDOWANA,
     *  - wyczerpane próby → jak trwały; inaczej jedna chora operacja blokuje
     *    wszystkie następne w nieskończoność.
     *
     * Kasowanie bez śladu nie jest tu żadną z opcji — to był właśnie ten błąd,
     * przez który praca magazyniera znikała bez odpowiedzi na pytanie „gdzie".
     */
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
                    val err = e as ApiError
                    if (czyPrzejsciowy(err) && op.proby + 1 < MAX_PROB) {
                        // serwer choruje, operacja jest zdrowa: zostaje na czele
                        // kolejki z podbitym licznikiem i wraca przy następnym flushu
                        persist(listOf(op.copy(proby = op.proby + 1)) + ops.drop(1))
                        break
                    }
                    persist(ops.drop(1))
                    odrzuc(op, err)
                }
            }
        } finally {
            flushMutex.unlock()
        }
    }

    private fun odrzuc(op: PendingOp, e: ApiError) {
        onRejected(op, e.message ?: "błąd")
        /* Meldunek na serwer. Bufor żyje w pliku na kolektorze, więc odrzucona
           operacja bez tego wpisu istnieje wyłącznie tam — a urządzenie zginie
           albo zostanie zresetowane. Meldunek jest „best effort": gdy sam nie
           przejdzie, nie wolno mu wywrócić opróżniania kolejki. */
        runCatching { reporter.report(op, e) }
    }

    companion object {
        /** Po tylu przejściowych odrzuceniach operacja przestaje blokować kolejkę. */
        const val MAX_PROB = 5
    }
}
