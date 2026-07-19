package pl.wertis.kolektor.net

import java.util.concurrent.TimeUnit
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Response
import pl.wertis.kolektor.core.net.ApiError
import pl.wertis.kolektor.core.net.ApiErrorBody
import pl.wertis.kolektor.core.net.MmConflict
import pl.wertis.kolektor.core.net.WertisJson
import retrofit2.HttpException
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory

/* ── Budowa klienta HTTP ────────────────────────────────────────────────────
   Adres serwera jest konfigurowalny w Ustawieniach (PWA działała same-origin,
   natywna aplikacja musi znać hosta) — HostSelectionInterceptor przepisuje
   każdy request na bieżący baseUrl. Timeouty krótkie: polling 1.5–2 s musi
   szybko wykrywać martwe Wi-Fi przy regałach.                                */

/** Przepisuje scheme/host/port każdego żądania na bieżący adres serwera. */
class HostSelectionInterceptor(@Volatile var baseUrl: HttpUrl?) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val base = baseUrl ?: return chain.proceed(chain.request())
        val url = chain.request().url.newBuilder()
            .scheme(base.scheme)
            .host(base.host)
            .port(base.port)
            .build()
        return chain.proceed(chain.request().newBuilder().url(url).build())
    }
}

/** Dokleja x-user (bieżący magazynier), o ile żądanie nie niesie go jawnie. */
class UserHeaderInterceptor(private val currentUser: () -> String) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val req = chain.request()
        if (req.header("x-user") != null) return chain.proceed(req)
        return chain.proceed(req.newBuilder().header("x-user", currentUser()).build())
    }
}

class ApiClient(currentUser: () -> String, initialBaseUrl: String) {
    val hostSelection = HostSelectionInterceptor(initialBaseUrl.toHttpUrlOrNull())

    private val okHttp = OkHttpClient.Builder()
        .connectTimeout(5, TimeUnit.SECONDS)
        .readTimeout(10, TimeUnit.SECONDS)
        .writeTimeout(10, TimeUnit.SECONDS)
        .addInterceptor(hostSelection)
        .addInterceptor(UserHeaderInterceptor(currentUser))
        .build()

    val service: ApiService = Retrofit.Builder()
        .baseUrl("http://wertis.invalid/") // zawsze nadpisywany przez HostSelectionInterceptor
        .client(okHttp)
        .addConverterFactory(WertisJson.asConverterFactory("application/json".toMediaType()))
        .build()
        .create(ApiService::class.java)

    fun setBaseUrl(url: String) {
        hostSelection.baseUrl = url.toHttpUrlOrNull()
    }
}

/**
 * Opakowanie wywołań API: HttpException → ApiError z komunikatem {error} serwera
 * (lustro req() z api.ts). Inne wyjątki (IOException…) przechodzą bez zmian —
 * to „błędy sieci” dla bufora offline.
 */
suspend fun <T> apiCall(block: suspend () -> T): T =
    try {
        block()
    } catch (e: HttpException) {
        throw e.toApiError()
    }

fun HttpException.toApiError(): ApiError {
    val status = code()
    var msg = "Błąd $status"
    var available: Double? = null
    try {
        val raw = response()?.errorBody()?.string()
        if (!raw.isNullOrBlank()) {
            val body = WertisJson.decodeFromString(ApiErrorBody.serializer(), raw)
            body.error?.let { msg = it }
            available = body.available
        }
    } catch (_: Exception) {
        /* brak treści / nie-JSON */
    }
    return if (available != null) MmConflict(status, msg, available) else ApiError(status, msg)
}
