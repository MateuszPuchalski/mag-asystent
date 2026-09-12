package pl.wertis.kolektor.data

import android.content.Context
import android.util.AtomicFile
import java.io.File
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.sync.Mutex
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import pl.wertis.kolektor.core.net.WertisJson
import pl.wertis.kolektor.core.net.naglowekHttp
import pl.wertis.kolektor.core.session.userId
import pl.wertis.kolektor.core.wms.WmsRecoveryController
import pl.wertis.kolektor.core.wms.WmsRecoveryTransport
import pl.wertis.kolektor.core.wms.WmsRecoveryTask
import pl.wertis.kolektor.core.wms.WmsRecoveryQueue
import pl.wertis.kolektor.core.wms.WmsContext
import pl.wertis.kolektor.core.wms.WmsController
import pl.wertis.kolektor.core.wms.WmsJournal
import pl.wertis.kolektor.core.wms.WmsPending
import pl.wertis.kolektor.core.wms.WmsRun
import pl.wertis.kolektor.core.wms.WmsStore
import pl.wertis.kolektor.core.wms.WmsTransport
import pl.wertis.kolektor.core.wms.WmsPutawayController
import pl.wertis.kolektor.core.wms.WmsPutawayQueue
import pl.wertis.kolektor.core.wms.WmsPutawayTask
import pl.wertis.kolektor.core.wms.WmsPutawayTransport
import pl.wertis.kolektor.core.wms.WmsInboundController
import pl.wertis.kolektor.core.wms.WmsInboundDocument
import pl.wertis.kolektor.core.wms.WmsInboundList
import pl.wertis.kolektor.core.wms.WmsInboundTransport
import pl.wertis.kolektor.net.apiCall
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Url
import retrofit2.http.Query

import pl.wertis.kolektor.core.wms.WmsCountController
import pl.wertis.kolektor.core.wms.WmsCountQueue
import pl.wertis.kolektor.core.wms.WmsCountTask
import pl.wertis.kolektor.core.wms.WmsCountTransport

import pl.wertis.kolektor.core.wms.WmsReplenishmentController
import pl.wertis.kolektor.core.wms.WmsReplenishmentQueue
import pl.wertis.kolektor.core.wms.WmsReplenishmentTask
import pl.wertis.kolektor.core.wms.WmsReplenishmentTransport

interface WmsApi {
    @POST
    suspend fun command(@Url path: String, @Header("idempotency-key") key: String, @Body body: JsonObject): JsonObject

    @GET("api/wms/cart-runs/{id}")
    suspend fun run(@Path("id") id: Long): WmsRun

    @GET("api/wms/packing-recovery")
    suspend fun recoveryQueue(@Query("q") query: String, @Query("offset") offset: Int): WmsRecoveryQueue

    @GET("api/wms/packing-recovery/{id}")
    suspend fun recoveryTask(@Path("id") id: Long): WmsRecoveryTask

    @GET("api/wms/replenishment-work")
    suspend fun replenishmentQueue(@Query("view") view: String, @Query("q") query: String, @Query("offset") offset: Int): WmsReplenishmentQueue

    @GET("api/wms/replenishment-work/{id}")
    suspend fun replenishmentTask(@Path("id") id: Long): WmsReplenishmentTask

    @GET("api/wms/count-work")
    suspend fun countingQueue(@Query("q") query: String, @Query("offset") offset: Int): WmsCountQueue

    @GET("api/wms/count-work/{id}")
    suspend fun countingTask(@Path("id") id: Long): WmsCountTask

    @GET("api/wms/putaway-work")
    suspend fun putawayQueue(@Query("q") query: String, @Query("offset") offset: Int): WmsPutawayQueue

    @GET("api/wms/putaway-work/{id}")
    suspend fun putawayTask(@Path("id") id: Long): WmsPutawayTask

    @GET("api/wms/inbound")
    suspend fun inboundList(@Query("q") query: String, @Query("offset") offset: Int): WmsInboundList

    @GET("api/wms/inbound/{id}/collector")
    suspend fun inboundDocument(@Path("id") id: Long, @Query("q") query: String, @Query("offset") offset: Int,
        @Query("lineId") lineId: Long?, @Query("barcode") barcode: String?): WmsInboundDocument
}

class WmsFileStore(context: Context) : WmsStore {
    // Dziennik nie może wrócić z kopii Google na DRUGI kolektor.
    private val file = AtomicFile(File(context.noBackupFilesDir, "wms-pending.json"))

    override suspend fun read(): WmsJournal = withContext(Dispatchers.IO) {
        if (!file.baseFile.exists() && !File(file.baseFile.path + ".bak").exists()) WmsJournal()
        else WertisJson.decodeFromString<WmsJournal>(file.openRead().use { it.readBytes().toString(Charsets.UTF_8) })
    }

    override suspend fun write(journal: WmsJournal) = withContext(Dispatchers.IO) {
        val bytes = WertisJson.encodeToString(WmsJournal.serializer(), journal).toByteArray(Charsets.UTF_8)
        val stream = file.startWrite()
        try {
            stream.write(bytes)
            // AtomicFile loguje część błędów synchronizacji zamiast je rzucać.
            // WMS musi zobaczyć odmowę dysku przed wysłaniem żądania.
            stream.fd.sync()
            file.finishWrite(stream)
        } catch (error: Exception) {
            file.failWrite(stream)
            throw error
        }
    }
}

class WmsRepository(context: Context, private val settings: SettingsRepository, private val session: SessionRepository) {
    private val store = WmsFileStore(context)
    private val writeLock = Mutex()
    private val http = OkHttpClient.Builder()
        .connectTimeout(5, TimeUnit.SECONDS).readTimeout(10, TimeUnit.SECONDS).writeTimeout(10, TimeUnit.SECONDS)
        // Przekierowanie nie może przenieść tokenu magazyniera na inny host.
        .followRedirects(false).followSslRedirects(false).build()

    fun context(): WmsContext? = session.state.value.userId?.let {
        WmsContext(settings.current.serverUrl.toHttpUrl().newBuilder().encodedPath("/").query(null).fragment(null).build().toString(), it)
    }

    private fun api(bound: WmsContext): WmsApi {
        check(context() == bound) { "Zmieniło się konto lub serwer" }
        val token = checkNotNull(session.token) { "Zaloguj się ponownie" }
        // W przeciwieństwie do klienta ekranów informacyjnych ten klient nie
        // odczytuje zmiennych ustawień w interceptorze. Żądanie w locie zachowuje
        // tożsamość i serwer, z którymi powstał jego trwały klucz ponowienia.
        val client = http.newBuilder().addInterceptor { chain ->
            chain.proceed(chain.request().newBuilder()
                .header("x-session", naglowekHttp(token))
                .header("x-device", naglowekHttp(settings.deviceId)).build())
        }.build()
        return Retrofit.Builder().baseUrl(bound.server).client(client)
            .addConverterFactory(WertisJson.asConverterFactory("application/json".toMediaType()))
            .build().create(WmsApi::class.java)
    }

    val controller = WmsController(store, lock = writeLock, transport = { bound ->
        val api = api(bound)
        object : WmsTransport {
            override suspend fun send(command: WmsPending): Long? {
                val response = apiCall { api.command(command.path, command.key, command.body) }
                if (command.runId != null) return command.runId
                val run = response["run"]
                return if (run is JsonObject) checkNotNull(run.jsonObject["id"]?.jsonPrimitive?.longOrNull) else {
                    check(run == JsonNull) { "Nieznana odpowiedź uruchomienia wózka" }
                    null
                }
            }
            override suspend fun run(id: Long) = apiCall { api.run(id) }
        }
    })

    val putaway = WmsPutawayController(store, lock = writeLock, transport = { bound ->
        val api = api(bound)
        object : WmsPutawayTransport {
            override suspend fun queue(query: String, offset: Int) = apiCall { api.putawayQueue(query, offset) }
            override suspend fun putawayTask(id: Long) = apiCall { api.putawayTask(id) }
            override suspend fun send(command: WmsPending) {
                apiCall { api.command(command.path, command.key, command.body) }
            }
        }
    })

    val counting = WmsCountController(store, lock = writeLock, transport = { bound ->
        val api = api(bound)
        object : WmsCountTransport {
            override suspend fun queue(query: String, offset: Int) = apiCall { api.countingQueue(query, offset) }
            override suspend fun countingTask(id: Long) = apiCall { api.countingTask(id) }
            override suspend fun send(command: WmsPending) {
                apiCall { api.command(command.path, command.key, command.body) }
            }
        }
    })

    val receiving = WmsInboundController(store, lock = writeLock, transport = { bound ->
        val api = api(bound)
        object : WmsInboundTransport {
            override suspend fun documents(query: String, offset: Int) = apiCall { api.inboundList(query, offset) }
            override suspend fun receiveDocument(id: Long, query: String, offset: Int, lineId: Long?, barcode: String?) =
                apiCall { api.inboundDocument(id, query, offset, lineId, barcode) }
            override suspend fun send(command: WmsPending) {
                apiCall { api.command(command.path, command.key, command.body) }
            }
        }
    })

    val replenishing = WmsReplenishmentController(store, lock = writeLock, transport = { bound ->
        val api = api(bound)
        object : WmsReplenishmentTransport {
            override suspend fun queue(view: String, query: String, offset: Int) = apiCall { api.replenishmentQueue(view, query, offset) }
            override suspend fun replenishingTask(id: Long) = apiCall { api.replenishmentTask(id) }
            override suspend fun send(command: WmsPending): Long {
                val result = apiCall { api.command(command.path, command.key, command.body) }
                return result["id"]?.jsonPrimitive?.longOrNull ?: error("Brak numeru zadania w odpowiedzi")
            }
        }
    })

    val recovering = WmsRecoveryController(store, lock = writeLock, transport = { bound ->
        val api = api(bound)
        object : WmsRecoveryTransport {
            override suspend fun queue(query: String, offset: Int) = apiCall { api.recoveryQueue(query, offset) }
            override suspend fun recoveringTask(id: Long) = apiCall { api.recoveryTask(id) }
            override suspend fun send(command: WmsPending): Long {
                val result = apiCall { api.command(command.path, command.key, command.body) }
                return result["id"]?.jsonPrimitive?.longOrNull ?: error("Brak numeru zadania w odpowiedzi")
            }
        }
    })

    fun resetConnections() = http.connectionPool.evictAll()
}
