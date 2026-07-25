package pl.wertis.kolektor.core.net

import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonClassDiscriminator

/* ── DTO REST — lustro web/src/lib/api.ts oraz server/src/types.ts ─────────
   Ilości/stany jako Double (JS number bywa ułamkiem), identyfikatory Long.  */

/** Wspólna konfiguracja JSON dla całej aplikacji. */
val WertisJson = Json {
    ignoreUnknownKeys = true
    coerceInputValues = true
    explicitNulls = false
    encodeDefaults = false
}

@Serializable
data class StockView(
    val stan: Double,
    val rez: Double,
    val avail: Double,
    val pendingIn: Double,
    val pendingOut: Double,
    val effective: Double,
)

@Serializable
data class ProductCard(
    val id: Long,
    val sym: String,
    val name: String,
    val ean: String,
    val unit: String,
    val ordered: Double = 0.0,
    val desc: String = "",
    val locs: List<String> = emptyList(),
    val mag: StockView,
    val mgp: StockView,
    /** Strefa zwrotów od klientów (magazyn Zwroty). */
    val zwroty: StockView? = null,
)

@Serializable
data class ProductRow(
    val id: Long,
    val sym: String,
    val name: String,
    val ean: String,
    val mag: Double,
    val mgp: Double,
    val locs: List<String> = emptyList(),
)

@Serializable
@OptIn(ExperimentalSerializationApi::class)
@JsonClassDiscriminator("type")
sealed interface ScanResult {
    @Serializable
    @SerialName("product")
    data class Product(val card: ProductCard) : ScanResult

    @Serializable
    @SerialName("search")
    data class Search(val results: List<ProductRow>) : ScanResult

    @Serializable
    @SerialName("notfound")
    data class NotFound(val code: String) : ScanResult
}

@Serializable
data class SearchResponse(val results: List<ProductRow>)

@Serializable
data class MovementEntry(
    val type: String,
    val user: String,
    val at: String,
    val detail: String,
)

@Serializable
data class HistoryResponse(val entries: List<MovementEntry>)

@Serializable
data class LocationsInfo(
    val codes: List<String> = emptyList(),
    val format: String = "",
    val strict: Boolean = false,
    val allowManual: Boolean = true,
)

@Serializable
data class LocationProductsResponse(
    val code: String,
    val products: List<ProductRow> = emptyList(),
)

@Serializable
enum class QueueItemType {
    @SerialName("set_location") SET_LOCATION,
    @SerialName("mm") MM,
    @SerialName("combo") COMBO,
}

@Serializable
enum class QueueStatus {
    @SerialName("pending") PENDING,
    @SerialName("processing") PROCESSING,
    @SerialName("waiting_for_doc") WAITING_FOR_DOC,
    @SerialName("done") DONE,
    @SerialName("error") ERROR,
    @SerialName("cancelled") CANCELLED,
}

@Serializable
data class QueueItem(
    val id: Long,
    val type: QueueItemType,
    val status: QueueStatus,
    val label: String,
    val detail: String = "",
    val errMsg: String? = null,
    val time: String = "",
)

@Serializable
data class QueueSummary(val pending: Int = 0, val error: Int = 0, val done: Int = 0)

@Serializable
data class QueueResponse(
    val items: List<QueueItem> = emptyList(),
    val summary: QueueSummary = QueueSummary(),
)

@Serializable
enum class PutawayZone {
    @SerialName("mgp") MGP,
    @SerialName("zwroty") ZWROTY,
}

@Serializable
data class PutawaySessionRef(val id: Long, val status: String, val progressPct: Double = 0.0)

@Serializable
data class PutawayDocument(
    val docId: Long,
    val typ: String,
    val nrPelny: String,
    val dataWyst: String = "",
    val dostawca: String = "",
    val positions: Int = 0,
    /** Strefa źródłowa: dostawy (MGP) lub zwroty od klientów. */
    val zone: PutawayZone = PutawayZone.MGP,
    /** Towar z dokumentu jest już na MAG (biuro zrobiło MM) — dostawa nadal do rozłożenia, bez MM. */
    val onMag: Boolean = false,
    val session: PutawaySessionRef? = null,
)

@Serializable
enum class PutawayItemStatus {
    @SerialName("pending") PENDING,
    @SerialName("on_cart") ON_CART,
    @SerialName("done") DONE,
    @SerialName("partial") PARTIAL,
    @SerialName("skipped") SKIPPED,
}

@Serializable
data class PutawayItem(
    val id: Long,
    val twId: Long,
    val sym: String,
    val name: String,
    val targetLoc: String? = null,
    val qtyExpected: Double = 0.0,
    val qtyDone: Double = 0.0,
    val delta: Double = 0.0,
    val mgpStan: Double = 0.0,
    val status: PutawayItemStatus = PutawayItemStatus.PENDING,
    val skipReason: String? = null,
    val lockedBy: String? = null,
    val offDocument: Boolean = false,
    val stageQty: Double? = null,
    val stageLoc: String? = null,
)

@Serializable
data class PutawayQueueAlert(
    val id: Long,
    val type: QueueItemType,
    val label: String,
    val detail: String = "",
    val errorMsg: String? = null,
)

@Serializable
data class PutawayDocumentsResponse(val documents: List<PutawayDocument> = emptyList())

@Serializable
data class PutawayProgress(val total: Int = 0, val done: Int = 0, val remaining: Int = 0, val onCart: Int = 0)

@Serializable
data class PutawaySession(
    val id: Long,
    val sourceDocId: Long? = null,
    val sourceDocNumber: String? = null,
    val zone: PutawayZone = PutawayZone.MGP,
    val status: String = "",
    val progress: PutawayProgress = PutawayProgress(),
    val queueAlerts: List<PutawayQueueAlert> = emptyList(),
    val inFlight: Int = 0,
    val items: List<PutawayItem> = emptyList(),
)

/* ── Ciała żądań ──────────────────────────────────────────────────────── */

@Serializable
enum class LocAction {
    @SerialName("replace") REPLACE,
    @SerialName("add") ADD,
    @SerialName("remove") REMOVE,
    @SerialName("replace_one") REPLACE_ONE,
}

@Serializable
data class SetLocationBody(
    val action: LocAction,
    val value: String? = null,
    val replaced: String? = null,
)

@Serializable
data class MmItem(val twId: Long, val qty: Double)

@Serializable
data class MmBody(val items: List<MmItem>)

@Serializable
data class CreateSessionBody(val docId: Long? = null, val mode: String? = null)

@Serializable
data class CartBody(val twId: Long, val offDocument: Boolean? = null)

@Serializable
data class CartRemoveBody(val itemId: Long)

@Serializable
data class ConfirmBody(
    val itemId: Long,
    val qty: Double,
    val location: String,
    val updateLoc: Boolean? = null,
)

@Serializable
data class SkipBody(val itemId: Long, val reason: String? = null)

@Serializable
data class DeviceEventBody(val type: String, val magnitude: Double? = null, val level: Double? = null)

/* ── Odpowiedzi ───────────────────────────────────────────────────────── */

@Serializable
data class QueueIdResponse(val queueId: Long, val kind: String? = null)

@Serializable
data class SessionIdResponse(val sessionId: Long)

@Serializable
data class OkResponse(val ok: Boolean = true)

/** Odpowiedź /cart — unia luźnych kształtów (web typuje jako any). */
@Serializable
data class CartResponse(
    val error: String? = null,
    val locked: Boolean? = null,
    val lockedBy: String? = null,
    val offDocument: Boolean? = null,
    val itemId: Long? = null,
    val twId: Long? = null,
    val sym: String? = null,
    val name: String? = null,
)

@Serializable
data class ConfirmResponse(val error: String? = null, val itemId: Long? = null, val status: String? = null)

@Serializable
data class CommitCartResponse(val queueIds: List<Long> = emptyList(), val committed: Int = 0)

@Serializable
data class CloseSessionResponse(val status: String, val summary: Map<String, Int> = emptyMap())


@Serializable
data class ApiErrorBody(val error: String? = null, val available: Double? = null)

/* ── Tryb A: rozkładanie dostaw (redesign v2.0) ─────────────────────────────
   Dokument FZ/PZ jest jednostką pracy; aplikacja zapisuje wyłącznie
   lokalizację (D1) — bez MM i bez czekania na bufor SGT.                     */

@Serializable
data class DeliveryDocument(
    val dokId: Long,
    val typ: String = "",
    val nrPelny: String = "",
    val dataWyst: String = "",
    val dostawca: String = "",
    val positions: Int = 0,
    /** Dokument w buforze SGT — nadal można na nim pracować. */
    val wBuforze: Boolean = false,
    val linesTotal: Int = 0,
    val linesDone: Int = 0,
    val status: String? = null,
)

@Serializable
data class DeliveryDocumentsResponse(val documents: List<DeliveryDocument> = emptyList())

@Serializable
data class DeliveryLineView(
    val id: Long,
    val twId: Long,
    val sym: String = "",
    val name: String = "",
    val qtyDoc: Double = 0.0,
    val qtyDone: Double = 0.0,
    val locExpected: String? = null,
    val locActual: String? = null,
    val status: String = "todo",
    /** Litera alejki — nagłówek sekcji listy; null = brak lokalizacji. */
    val aisle: String? = null,
)

@Serializable
data class DeliveryProgress(
    val total: Int = 0,
    val done: Int = 0,
    val remaining: Int = 0,
    /** Podzbiór `done`: linie wyjęte z rutyny przez zgłoszony wyjątek (D8). */
    val problems: Int = 0,
)

@Serializable
data class DeliveryView(
    val id: Long,
    val dokId: Long = 0,
    val nrPelny: String = "",
    val dostawca: String = "",
    val dataWyst: String = "",
    val status: String = "open",
    val progress: DeliveryProgress = DeliveryProgress(),
    val lines: List<DeliveryLineView> = emptyList(),
)

@Serializable
data class OpenDeliveryResponse(val deliveryId: Long)

/** Kandydat przy niejednoznacznym kodzie kreskowym (D7). */
@Serializable
data class EanCandidate(
    val twId: Long,
    val sym: String = "",
    val name: String = "",
    val inDocument: Boolean = false,
    val qtyDoc: Double? = null,
    val locExpected: String? = null,
)

/** Wynik skanu towaru w kontekście dostawy (dyskryminator `kind`). */
@Serializable
@OptIn(ExperimentalSerializationApi::class)
@JsonClassDiscriminator("kind")
sealed class ScanResolution {
    @Serializable @SerialName("line")
    data class Line(val line: DeliveryLineView) : ScanResolution()

    /** Kod wskazuje >1 kartotekę — operacja STOI, użytkownik wybiera (D7). */
    @Serializable @SerialName("conflict")
    data class Conflict(val code: String = "", val candidates: List<EanCandidate> = emptyList()) : ScanResolution()

    @Serializable @SerialName("off_document")
    data class OffDocument(val code: String = "", val twId: Long = 0, val sym: String = "", val name: String = "") : ScanResolution()

    @Serializable @SerialName("unknown")
    data class Unknown(val code: String = "") : ScanResolution()
}

@Serializable
data class ScanBody(val code: String)

@Serializable
data class PutawayLineBody(
    val location: String,
    val qty: Double? = null,
    /**
     * Rozjazd lokalizacji (§4.3) — decyduje magazynier, nie serwer: „ZAMIEŃ"
     * gdy towar przeniesiono, „DODAJ" gdy leży teraz w dwóch miejscach.
     * `null` = ścieżka bez rozjazdu (serwer przyjmuje domyślne `replace`).
     */
    val locAction: LocApplyAction? = null,
)

/** Wybór operatora przy skanie innej półki niż oczekiwana (§4.3). */
@Serializable
enum class LocApplyAction {
    @SerialName("add") ADD,
    @SerialName("replace") REPLACE,
}

@Serializable
data class PutawayLineResponse(
    val ok: Boolean = true,
    val queueId: Long? = null,
    val mismatch: Boolean = false,
    val status: String = "",
)

/* ── Faza 2: wyjątki jako obiekt pierwszej klasy (D8) ────────────────────────
   Wyjątek to wiersz w bazie ze zdjęciem, nie notatka w głowie magazyniera —
   inaczej nie da się go zmierzyć ani zgłosić reklamacji dostawcy.            */

@Serializable
data class ProblemTypesResponse(val types: List<String> = emptyList())

@Serializable
data class ProblemView(
    val id: Long,
    val deliveryId: Long? = null,
    val lineId: Long? = null,
    val typ: String = "",
    val qty: Double? = null,
    val opis: String? = null,
    val hasPhoto: Boolean = false,
    val createdAt: String = "",
    val createdBy: String? = null,
    val resolvedAt: String? = null,
    val resolvedNote: String? = null,
    /** Kontekst do listy „nierozwiązane" — bez wchodzenia w dostawę. */
    val docNumber: String? = null,
    val sym: String? = null,
    val name: String? = null,
)

@Serializable
data class ProblemsResponse(val problems: List<ProblemView> = emptyList())

@Serializable
data class RaiseProblemBody(
    val typ: String,
    val lineId: Long? = null,
    val qty: Double? = null,
    val opis: String? = null,
    /** JPEG w base64 — dowód do reklamacji; serwer zapisuje na dysk. */
    val photoBase64: String? = null,
)

@Serializable
data class RaiseProblemResponse(val id: Long)

@Serializable
data class ResolveProblemBody(val note: String? = null)

/** Kolizja EAN w kartotece — raport dla biura (§4.5). */
@Serializable
data class EanConflictRow(
    val ean: String = "",
    val hits: Int = 0,
    val autoResolved: Int = 0,
    val twIds: List<Long> = emptyList(),
    val lastSeen: String = "",
)

@Serializable
data class EanConflictsResponse(val conflicts: List<EanConflictRow> = emptyList())
