package pl.wertis.kolektor.data

import android.content.Context
import android.util.AtomicFile
import java.io.File
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
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
import pl.wertis.kolektor.core.wms.WmsContext
import pl.wertis.kolektor.core.wms.WmsController
import pl.wertis.kolektor.core.wms.WmsJournal
import pl.wertis.kolektor.core.wms.WmsPending
import pl.wertis.kolektor.core.wms.WmsRun
import pl.wertis.kolektor.core.wms.WmsStore
import pl.wertis.kolektor.core.wms.WmsTransport
import pl.wertis.kolektor.net.apiCall
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Url

interface WmsApi {
    @POST
    suspend fun command(@Url path: String, @Header("idempotency-key") key: String, @Body body: JsonObject): JsonObject

    @GET("api/wms/cart-runs/{id}")
    suspend fun run(@Path("id") id: Long): WmsRun
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
    private val http = OkHttpClient.Builder()
        .connectTimeout(5, TimeUnit.SECONDS).readTimeout(10, TimeUnit.SECONDS).writeTimeout(10, TimeUnit.SECONDS)
        // Przekierowanie nie może przenieść tokenu magazyniera na inny host.
        .followRedirects(false).followSslRedirects(false).build()

    fun context(): WmsContext? = session.state.value.userId?.let {
        WmsContext(settings.current.serverUrl.toHttpUrl().newBuilder().encodedPath("/").query(null).fragment(null).build().toString(), it)
    }

    val controller = WmsController(WmsFileStore(context), transport = { bound ->
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
        val api = Retrofit.Builder().baseUrl(bound.server).client(client)
            .addConverterFactory(WertisJson.asConverterFactory("application/json".toMediaType()))
            .build().create(WmsApi::class.java)
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

    fun resetConnections() = http.connectionPool.evictAll()
}
