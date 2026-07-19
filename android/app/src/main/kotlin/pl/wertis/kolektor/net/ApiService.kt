package pl.wertis.kolektor.net

import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import pl.wertis.kolektor.core.net.CartBody
import pl.wertis.kolektor.core.net.CartRemoveBody
import pl.wertis.kolektor.core.net.CartResponse
import pl.wertis.kolektor.core.net.CloseSessionResponse
import pl.wertis.kolektor.core.net.CommitCartResponse
import pl.wertis.kolektor.core.net.ConfirmBody
import pl.wertis.kolektor.core.net.ConfirmResponse
import pl.wertis.kolektor.core.net.CreateSessionBody
import pl.wertis.kolektor.core.net.DeviceEventBody
import pl.wertis.kolektor.core.net.HealthResponse
import pl.wertis.kolektor.core.net.HistoryResponse
import pl.wertis.kolektor.core.net.LocationProductsResponse
import pl.wertis.kolektor.core.net.LocationsInfo
import pl.wertis.kolektor.core.net.MmBody
import pl.wertis.kolektor.core.net.OkResponse
import pl.wertis.kolektor.core.net.ProductCard
import pl.wertis.kolektor.core.net.PutawayDocumentsResponse
import pl.wertis.kolektor.core.net.PutawaySession
import pl.wertis.kolektor.core.net.QueueIdResponse
import pl.wertis.kolektor.core.net.QueueResponse
import pl.wertis.kolektor.core.net.ScanResult
import pl.wertis.kolektor.core.net.SearchResponse
import pl.wertis.kolektor.core.net.SessionIdResponse
import pl.wertis.kolektor.core.net.SetLocationBody
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
    @GET("api/products/scan/{code}")
    suspend fun scan(@Path("code") code: String): ScanResult

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

    @POST("api/mm")
    suspend fun mm(@Body body: MmBody, @Header("x-user") asUser: String? = null): QueueIdResponse

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

    @GET("api/health")
    suspend fun health(): HealthResponse
}
