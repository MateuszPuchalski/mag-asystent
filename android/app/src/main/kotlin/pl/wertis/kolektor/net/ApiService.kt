package pl.wertis.kolektor.net

import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import pl.wertis.kolektor.core.net.KorektaBody
import pl.wertis.kolektor.core.net.LoginBody
import pl.wertis.kolektor.core.net.OdpowiedzBody
import pl.wertis.kolektor.core.net.ZakonczenieDostawy
import pl.wertis.kolektor.core.net.CreateUserBody
import pl.wertis.kolektor.core.net.CreateUserResponse
import pl.wertis.kolektor.core.net.MagazynyResponse
import pl.wertis.kolektor.core.net.WidocznoscRequest
import pl.wertis.kolektor.core.net.DeviceEventBody
import pl.wertis.kolektor.core.net.EanConflictsResponse
import pl.wertis.kolektor.core.net.HealthResponse
import pl.wertis.kolektor.core.net.HistoryResponse
import pl.wertis.kolektor.core.net.LoginResponse
import pl.wertis.kolektor.core.net.MeResponse
import pl.wertis.kolektor.core.net.LocationProductsResponse
import pl.wertis.kolektor.core.net.LocationsInfo
import pl.wertis.kolektor.core.net.MeldunekOdrzuconych
import pl.wertis.kolektor.core.net.MeldunekPrzyjety
import pl.wertis.kolektor.core.net.OkResponse
import pl.wertis.kolektor.core.net.ProblemsResponse
import pl.wertis.kolektor.core.net.PrzesylkaBody
import pl.wertis.kolektor.core.net.ProductCard
import pl.wertis.kolektor.core.net.PrzesuniecieBody
import pl.wertis.kolektor.core.net.PrzesuniecieResponse
import pl.wertis.kolektor.core.net.RaiseProblemBody
import pl.wertis.kolektor.core.net.RaiseProblemResponse
import pl.wertis.kolektor.core.net.ResolveProblemBody
import pl.wertis.kolektor.core.net.DeliveryDocumentsResponse
import pl.wertis.kolektor.core.net.DeliveryView
import pl.wertis.kolektor.core.net.OpenDeliveryResponse
import pl.wertis.kolektor.core.net.PutawayLineBody
import pl.wertis.kolektor.core.net.PutawayLineResponse
import pl.wertis.kolektor.core.net.ScanBody
import pl.wertis.kolektor.core.net.ScanResolution
import pl.wertis.kolektor.core.net.QueueIdResponse
import pl.wertis.kolektor.core.net.QueueResponse
import pl.wertis.kolektor.core.net.ScanResult
import pl.wertis.kolektor.core.net.SearchResponse
import pl.wertis.kolektor.core.net.SetEanBody
import pl.wertis.kolektor.core.net.SetLocationBody
import pl.wertis.kolektor.core.net.SetupResponse
import okhttp3.ResponseBody
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query
import retrofit2.http.Streaming

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

    /**
     * Zdjęcie kartoteki — BAJTY, nie JSON, i jedyna trasa w tym pliku zwracająca
     * `Response<…>`. Status musi być widoczny wołającemu: 304 znaczy „to, co
     * masz w cache, jest aktualne", a `apiCall` zamieniłoby go w wyjątek
     * dokładnie tak samo jak 500 — czyli kolektor pobierałby obraz od nowa
     * przy każdym wejściu na kartę.
     */
    @Streaming
    @GET("api/products/{id}/zdjecie")
    suspend fun zdjecie(
        @Path("id") id: Long,
        @Header("If-None-Match") etag: String? = null,
    ): Response<ResponseBody>

    @POST("api/products/{id}/location")
    suspend fun setLocation(
        @Path("id") id: Long,
        @Body body: SetLocationBody,
        @Header("x-user") asUser: String? = null,
        /** Konto autora dla operacji z bufora — patrz `ApiOpSender`. */
        @Header("x-buffered-user") bufferedUser: String? = null,
    ): QueueIdResponse

    /**
     * Nadanie kodu kreskowego kartotece (0.37.0).
     *
     * BEZ BUFORA OFFLINE — świadomie, tak jak przesunięcie stanu. Bufor istnieje
     * dla pracy w rytmie przy regale, w martwych strefach Wi-Fi. Nadanie kodu
     * jest czynnością rzadką i rozstrzygającą o danych WSPÓLNYCH: pytanie „czy
     * ten kod nie należy już do innej kartoteki" musi paść, gdy człowiek jeszcze
     * stoi przy półce i może odpowiedzieć, a nie godzinę później przy
     * odbuforowaniu.
     */
    @POST("api/products/{id}/ean")
    suspend fun setEan(
        @Path("id") id: Long,
        @Body body: SetEanBody,
    ): QueueIdResponse

    /**
     * Meldunek o operacjach, których kolektor NIE ZDOŁAŁ wykonać.
     *
     * Bufor offline żyje w pliku na urządzeniu — a urządzenie zginie albo
     * zostanie zresetowane. Bez tego wywołania operacja odrzucona przez serwer
     * znikała razem z plikiem i nikt nie umiał powiedzieć magazynierowi, co się
     * stało z jego skanem.
     */
    @POST("api/events/kolektor")
    suspend fun meldujOdrzucone(@Body body: MeldunekOdrzuconych): MeldunekPrzyjety

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

    /**
     * Przesunięcie stanu między magazynami — jedyne miejsce, w którym powstaje
     * dokument MM. Bez bufora offline: patrz `PrzesuniecieSheet`.
     */
    @POST("api/przesuniecie")
    suspend fun przesun(@Body body: PrzesuniecieBody): PrzesuniecieResponse

    /* ── Rozkładanie faktur zakupu (dokument = jednostka pracy) ────────── */

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
        @Header("x-user") asUser: String? = null,
        /** Konto autora dla operacji z bufora — patrz `ApiOpSender`. */
        @Header("x-buffered-user") bufferedUser: String? = null,
    ): PutawayLineResponse


    /** Korekta ilości odłożonej — wartość bezwzględna, wyłącznie przed zamknięciem. */
    @POST("api/delivery/{id}/lines/{lineId}/korekta")
    suspend fun deliveryKorekta(
        @Path("id") id: Long,
        @Path("lineId") lineId: Long,
        @Body body: KorektaBody,
    ): OkResponse

    /** Odpowiedź na notatkę biura — jedyna droga zdjęcia blokady z dostawy. */
    @POST("api/delivery/notatki/{noteId}/odpowiedz")
    suspend fun deliveryOdpowiedzNotatka(
        @Path("noteId") noteId: Long,
        @Body body: OdpowiedzBody,
    ): OkResponse

    /** Co powstanie przy zakończeniu dostawy — czysty odczyt, bez zapisu. */
    @GET("api/delivery/{id}/zakonczenie")
    suspend fun deliveryZakonczenie(@Path("id") id: Long): ZakonczenieDostawy

    /** Zakończenie dostawy: braki → wyjątki „zła ilość", nietknięte → pominięte. */
    @POST("api/delivery/{id}/zakoncz")
    suspend fun deliveryZakoncz(@Path("id") id: Long): ZakonczenieDostawy

    /* ── Faza 2: wyjątki (D8) ────────────────────────────────────────────── */

    /** Lista pytana przy starcie — wyjątek bez ekranu przestaje istnieć. */
    @GET("api/problems/unresolved")
    suspend fun unresolvedProblems(): ProblemsResponse

    @POST("api/problems/{id}/resolve")
    suspend fun resolveProblem(@Path("id") id: Long, @Body body: ResolveProblemBody): OkResponse

    @POST("api/delivery/{id}/problems")
    suspend fun raiseProblem(@Path("id") id: Long, @Body body: RaiseProblemBody): RaiseProblemResponse

    /** Numer przesyłki i protokół kuriera — dotyczą paczki, nie pojedynczego towaru. */
    @POST("api/delivery/{id}/przesylka")
    suspend fun zapiszPrzesylke(@Path("id") id: Long, @Body body: PrzesylkaBody): OkResponse

    @GET("api/ean-conflicts")
    suspend fun eanConflicts(): EanConflictsResponse

    /* ── Tożsamość: login i hasło (plan §7) ────────────────────────────────
       Token sesji dokleja `IdentityHeaderInterceptor`, więc trasy poniżej go
       nie przyjmują — jedno miejsce, w którym żyje nagłówek.                */

    @POST("api/auth/login")
    suspend fun authLogin(@Body body: LoginBody): LoginResponse

    @GET("api/auth/me")
    suspend fun authMe(): MeResponse

    @POST("api/auth/logout")
    suspend fun authLogout(@Body body: RequestBody = EMPTY_BODY): OkResponse


    /* ── Zakładanie kont z kolektora ──────────────────────────────────────
       Pierwsze konto przechodzi bez sesji, ale TYLKO przy pustej bazie;
       każde następne wymaga nagłówka `x-session` biura.                    */

    @GET("api/setup")
    suspend fun setupPotrzebny(): SetupResponse

    @POST("api/users")
    suspend fun createUser(@Body body: CreateUserBody): CreateUserResponse

    /* ── Widoczność magazynów ─────────────────────────────────────────────
       Ustawienie GLOBALNE: zapis przestawia je wszystkim kolektorom naraz,
       więc wymaga konta biura. Odczyt wystarczy zwykłą sesją — lista
       magazynów firmy nie jest tajemnicą, w odróżnieniu od listy kont.     */

    /** Wersja serwera do paska na dole ekranu. Nie wymaga sesji. */
    @GET("api/health")
    suspend fun health(): HealthResponse

    @GET("api/magazyny")
    suspend fun listMagazyny(): MagazynyResponse

    @POST("api/magazyny/widocznosc")
    suspend fun setWidocznoscMagazynow(@Body body: WidocznoscRequest): MagazynyResponse
}
