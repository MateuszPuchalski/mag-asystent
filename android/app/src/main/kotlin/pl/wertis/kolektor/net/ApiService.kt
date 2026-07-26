package pl.wertis.kolektor.net

import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import pl.wertis.kolektor.core.net.BadgeBody
import pl.wertis.kolektor.core.net.CartBody
import pl.wertis.kolektor.core.net.CartRemoveBody
import pl.wertis.kolektor.core.net.CartResponse
import pl.wertis.kolektor.core.net.CloseSessionResponse
import pl.wertis.kolektor.core.net.CommitCartResponse
import pl.wertis.kolektor.core.net.ConfirmBody
import pl.wertis.kolektor.core.net.ConfirmResponse
import pl.wertis.kolektor.core.net.CreateSessionBody
import pl.wertis.kolektor.core.net.DeviceEventBody
import pl.wertis.kolektor.core.net.EanConflictsResponse
import pl.wertis.kolektor.core.net.ForceReleaseBody
import pl.wertis.kolektor.core.net.ForceReleaseResponse
import pl.wertis.kolektor.core.net.HandoverBody
import pl.wertis.kolektor.core.net.HistoryResponse
import pl.wertis.kolektor.core.net.LoginResponse
import pl.wertis.kolektor.core.net.MeResponse
import pl.wertis.kolektor.core.net.LocationProductsResponse
import pl.wertis.kolektor.core.net.LocationsInfo
import pl.wertis.kolektor.core.net.OkResponse
import pl.wertis.kolektor.core.net.ProblemTypesResponse
import pl.wertis.kolektor.core.net.ProblemsResponse
import pl.wertis.kolektor.core.net.ProductCard
import pl.wertis.kolektor.core.net.PutawayDocumentsResponse
import pl.wertis.kolektor.core.net.RaiseProblemBody
import pl.wertis.kolektor.core.net.RaiseProblemResponse
import pl.wertis.kolektor.core.net.ResolveProblemBody
import pl.wertis.kolektor.core.net.CloseBasketResponse
import pl.wertis.kolektor.core.net.DeliveryDocumentsResponse
import pl.wertis.kolektor.core.net.DeliveryView
import pl.wertis.kolektor.core.net.OpenDeliveryResponse
import pl.wertis.kolektor.core.net.PutawayLineBody
import pl.wertis.kolektor.core.net.PutawayLineResponse
import pl.wertis.kolektor.core.net.ScanBody
import pl.wertis.kolektor.core.net.ScanResolution
import pl.wertis.kolektor.core.net.PutawaySession
import pl.wertis.kolektor.core.net.QueueIdResponse
import pl.wertis.kolektor.core.net.QueueResponse
import pl.wertis.kolektor.core.net.ScanResult
import pl.wertis.kolektor.core.net.SearchResponse
import pl.wertis.kolektor.core.net.SessionIdResponse
import pl.wertis.kolektor.core.net.SetLocationBody
import pl.wertis.kolektor.core.net.UnlockResponse
import pl.wertis.kolektor.core.net.SkipBody
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query

/* ── Klient REST — lustro web/src/lib/api.ts ────────────────────────────────
   Nagłówek x-user dokleja UserHeaderInterceptor; parametr asUser nadpisuje go
   dla operacji odtwarzanych z bufora offline (autor z chwili zbuforowania).  */

/** POST bez ciała: puste body BEZ content-type (Fastify odrzuca puste JSON). */
val EMPTY_BODY: RequestBody = ByteArray(0).toRequestBody(null)

interface ApiService {
    /**
     * @param manual `1` gdy kod wpisano z ręki, nie zeskanowano — udział wpisów
     *   ręcznych per regał to darmowy raport jakości etykiet (plan §10).
     */
    @GET("api/products/scan/{code}")
    suspend fun scan(
        @Path("code") code: String,
        @Query("manual") manual: String? = null,
        @Query("screen") screen: String? = null,
    ): ScanResult

    @GET("api/products/search")
    suspend fun search(@Query("q") q: String): SearchResponse

    @GET("api/products/{id}")
    suspend fun product(@Path("id") id: Long): ProductCard

    @GET("api/products/{id}/history")
    suspend fun history(@Path("id") id: Long): HistoryResponse

    @POST("api/products/{id}/location")
    suspend fun setLocation(
        @Path("id") id: Long,
        @Body body: SetLocationBody,
        @Header("x-user") asUser: String? = null,
    ): QueueIdResponse

    @GET("api/locations")
    suspend fun locations(): LocationsInfo

    @GET("api/locations/{code}/products")
    suspend fun locationProducts(@Path("code") code: String): LocationProductsResponse

    @POST("api/device/event")
    suspend fun deviceEvent(@Body body: DeviceEventBody): OkResponse

    @GET("api/queue")
    suspend fun queue(): QueueResponse

    @POST("api/queue/{id}/retry")
    suspend fun retry(@Path("id") id: Long, @Body body: RequestBody = EMPTY_BODY): OkResponse

    @POST("api/queue/{id}/cancel")
    suspend fun cancel(@Path("id") id: Long, @Body body: RequestBody = EMPTY_BODY): OkResponse

    @GET("api/putaway/documents")
    suspend fun putawayDocuments(): PutawayDocumentsResponse

    @POST("api/putaway/sessions")
    suspend fun createSession(@Body body: CreateSessionBody): SessionIdResponse

    @GET("api/putaway/sessions/{id}")
    suspend fun session(@Path("id") id: Long): PutawaySession

    @POST("api/putaway/sessions/{id}/cart")
    suspend fun cart(@Path("id") sid: Long, @Body body: CartBody): CartResponse

    @POST("api/putaway/sessions/{id}/cart/remove")
    suspend fun cartRemove(@Path("id") sid: Long, @Body body: CartRemoveBody): CartResponse

    @POST("api/putaway/sessions/{id}/confirm")
    suspend fun confirm(@Path("id") sid: Long, @Body body: ConfirmBody): ConfirmResponse

    @POST("api/putaway/sessions/{id}/skip")
    suspend fun skip(@Path("id") sid: Long, @Body body: SkipBody): CartResponse

    @POST("api/putaway/sessions/{id}/commit-cart")
    suspend fun commitCart(@Path("id") sid: Long, @Body body: RequestBody = EMPTY_BODY): CommitCartResponse

    @POST("api/putaway/sessions/{id}/close")
    suspend fun closeSession(@Path("id") sid: Long, @Body body: RequestBody = EMPTY_BODY): CloseSessionResponse


    /* ── Tryb A: rozkładanie dostaw i zwrotów (dokument = jednostka pracy) ─ */

    @GET("api/delivery/documents")
    suspend fun deliveryDocuments(): DeliveryDocumentsResponse

    @POST("api/delivery/documents/{dokId}/open")
    suspend fun openDelivery(@Path("dokId") dokId: Long): OpenDeliveryResponse

    @GET("api/delivery/{id}")
    suspend fun delivery(@Path("id") id: Long): DeliveryView

    /** Skan towaru → linia / kolizja EAN / spoza dokumentu / nieznany. */
    @POST("api/delivery/{id}/scan")
    suspend fun deliveryScan(@Path("id") id: Long, @Body body: ScanBody): ScanResolution

    /** Odłożenie linii — skan lokalizacji obowiązkowy, bez MM. */
    @POST("api/delivery/{id}/lines/{lineId}/putaway")
    suspend fun deliveryPutaway(
        @Path("id") id: Long,
        @Path("lineId") lineId: Long,
        @Body body: PutawayLineBody,
    ): PutawayLineResponse

    /** Zwroty: koszyk rozłożony → jeden dokument MM Zwroty→MAG. */
    @POST("api/delivery/{id}/koszyk/{numer}/zamknij")
    suspend fun closeBasket(
        @Path("id") id: Long,
        @Path("numer") numer: String,
        @Body body: RequestBody = EMPTY_BODY,
    ): CloseBasketResponse

    /** Oddanie linii po ANULUJ — bez tego wisi zajęta do wygaśnięcia TTL. */
    @POST("api/delivery/{id}/lines/{lineId}/release")
    suspend fun releaseLine(
        @Path("id") id: Long,
        @Path("lineId") lineId: Long,
        @Body body: RequestBody = EMPTY_BODY,
    ): OkResponse


    /* ── Faza 2: wyjątki (D8) ────────────────────────────────────────────── */

    @GET("api/problems/types")
    suspend fun problemTypes(): ProblemTypesResponse

    /** Lista pytana przy starcie — wyjątek bez ekranu przestaje istnieć. */
    @GET("api/problems/unresolved")
    suspend fun unresolvedProblems(): ProblemsResponse

    @POST("api/problems/{id}/resolve")
    suspend fun resolveProblem(@Path("id") id: Long, @Body body: ResolveProblemBody): OkResponse

    @POST("api/delivery/{id}/problems")
    suspend fun raiseProblem(@Path("id") id: Long, @Body body: RaiseProblemBody): RaiseProblemResponse

    @GET("api/delivery/{id}/problems")
    suspend fun deliveryProblems(@Path("id") id: Long): ProblemsResponse

    @GET("api/ean-conflicts")
    suspend fun eanConflicts(): EanConflictsResponse

    /* ── Tożsamość: badge zamiast wolnego tekstu (plan §7) ─────────────────
       Token sesji dokleja `IdentityHeaderInterceptor`, więc trasy poniżej go
       nie przyjmują — jedno miejsce, w którym żyje nagłówek.                */

    @POST("api/auth/badge")
    suspend fun authBadge(@Body body: BadgeBody): LoginResponse

    @GET("api/auth/me")
    suspend fun authMe(): MeResponse

    @POST("api/auth/unlock")
    suspend fun authUnlock(@Body body: BadgeBody): UnlockResponse

    /** Wołane DOPIERO po potwierdzeniu przez człowieka — nigdy z samego skanu. */
    @POST("api/auth/handover")
    suspend fun authHandover(@Body body: HandoverBody): LoginResponse

    @POST("api/auth/logout")
    suspend fun authLogout(@Body body: RequestBody = EMPTY_BODY): OkResponse

    /** Odebranie cudzej linii przed TTL — wymaga PIN-u, nie samego badge'a. */
    @POST("api/delivery/{id}/lines/{lineId}/force-release")
    suspend fun forceReleaseLine(
        @Path("id") deliveryId: Long,
        @Path("lineId") lineId: Long,
        @Body body: ForceReleaseBody,
    ): ForceReleaseResponse
}
