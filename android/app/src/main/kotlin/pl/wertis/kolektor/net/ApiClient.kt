package pl.wertis.kolektor.net

import java.io.File
import java.util.concurrent.TimeUnit
import okhttp3.Cache
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Response
import pl.wertis.kolektor.core.net.ApiError
import pl.wertis.kolektor.core.net.ApiErrorBody
import pl.wertis.kolektor.core.net.EanOdmowa
import pl.wertis.kolektor.core.net.MmConflict
import pl.wertis.kolektor.core.net.WertisJson
import pl.wertis.kolektor.core.net.dlugiePobranie
import pl.wertis.kolektor.core.net.naglowekHttp
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

/**
 * Dokleja `x-session` (token sesji), `x-user` (podpowiedź) i `x-device`.
 *
 * `x-session` to TOŻSAMOŚĆ: serwer rozstrzyga ją z tokenu wydanego po skanie
 * badge'a. `x-user` zostaje wyłącznie jako podpowiedź dla instalacji, które
 * nie przeszły jeszcze na badge'y — dało się go wpisać ręcznie, więc nigdy nie
 * był dowodem, tylko deklaracją (plan §7).
 *
 * `x-device` jest polem diagnostycznym: przy współdzielonych kolektorach
 * pierwsze pytanie przy awarii brzmi „to jedno urządzenie czy wszystkie?",
 * a bez zapisu nie da się na nie odpowiedzieć po fakcie.
 */
class IdentityHeaderInterceptor(
    private val currentUser: () -> String,
    private val sessionToken: () -> String?,
    private val deviceId: String,
) : Interceptor {
    /*
     * KAŻDA wartość idzie przez `naglowekHttp`, nie tylko nazwisko.
     *
     * OkHttp rzuca `IllegalArgumentException` przy pierwszym znaku spoza
     * ` `–`~`, a leci to z wątku dyspozytora, gdzie nikt tego nie łapie —
     * czyli aplikacja ginie. Tak właśnie wywracał się każdy magazynier
     * z polską literą w nazwie konta (0.60.3).
     *
     * `deviceId` to UUID, a token to hex, więc dziś są bezpieczne. Ale
     * interceptor, który MOŻE rzucić wyjątkiem, jest bombą z opóźnionym
     * zapłonem i nie ma powodu zostawiać jej uzbrojonej.
     */
    override fun intercept(chain: Interceptor.Chain): Response {
        val req = chain.request()
        val b = req.newBuilder().header("x-device", naglowekHttp(deviceId))
        sessionToken()?.let { b.header("x-session", naglowekHttp(it)) }
        if (req.header("x-user") == null) b.header("x-user", naglowekHttp(currentUser()))
        return chain.proceed(b.build())
    }
}

/* ── Limit czasu zależny od trasy (0.71.1) ───────────────────────────────────
   Ze zgłoszenia: „pobieranie jest bardzo wolne i dostaję timeout". Winne nie
   było ani łącze, ani kod pobierania — kolektor czyta strumieniem, a serwer
   strumieniem wysyła. Winny był JEDEN limit opisujący dwie różne sytuacje.

   `readTimeout` niżej wynosi 10 s i ma wynosić: ekrany odpytują serwer co
   1,5–2 s, więc dziesięć sekund ciszy przy kilku kilobajtach JSON-a znaczy
   „sieci nie ma" i kolektor ma to wykryć od razu, stojąc przy regale.

   Tym samym klientem szło jednak APK ważące kilkanaście megabajtów, gdzie
   dziesięć sekund bez bajtu jest normalne — Wi-Fi w hali bywa obciążone,
   a przeskok między punktami dostępowymi robi dokładnie taką przerwę.

   Podnosimy więc limit TYLKO tam, gdzie leci plik. Odwrotna droga (dłuższy
   limit globalnie) naprawiłaby rzecz zdarzającą się raz na wydanie kosztem
   rzeczy używanej co dwie sekundy.

   Świadomie BEZ `callTimeout`: całkowity limit na kilkanaście megabajtów przez
   słabe Wi-Fi to zgadywanie, ile wolno trwać czemuś, co i tak pokazuje postęp
   człowiekowi. Limit ma pilnować MILCZENIA łącza, nie długości pobierania. */
private const val SEKUND_DLUGIE_POBRANIE = 60

class LimityCzasuInterceptor : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val req = chain.request()
        if (!dlugiePobranie(req.url.encodedPath)) return chain.proceed(req)
        return chain
            .withReadTimeout(SEKUND_DLUGIE_POBRANIE, TimeUnit.SECONDS)
            .proceed(req)
    }
}

class ApiClient(
    currentUser: () -> String,
    sessionToken: () -> String?,
    deviceId: String,
    initialBaseUrl: String,
    /** Katalog na cache HTTP; null = bez cache (testy). */
    cacheDir: File? = null,
) {
    val hostSelection = HostSelectionInterceptor(initialBaseUrl.toHttpUrlOrNull())

    private val okHttp = OkHttpClient.Builder()
        .connectTimeout(5, TimeUnit.SECONDS)
        .readTimeout(10, TimeUnit.SECONDS)
        .writeTimeout(10, TimeUnit.SECONDS)
        /* Cache dyskowy współpracuje z ETagami serwera: odpowiedzi odpytywane
           co 1,5–2 s wracają jako puste 304, gdy nic się nie zmieniło, a OkHttp
           podaje kopię z dysku — Retrofit nigdy nie widzi 304. Serwer wysyła
           `no-cache` (przymus rewalidacji), więc offline nic nie jedzie
           z dysku bez potwierdzenia — zachowanie bez sieci pozostaje przy
           buforze offline i ostatniej dobrej wartości pollFlow. Klucz cache
           to URL PO przepisaniu hosta, więc zmiana serwera nie miesza kopii. */
        .apply { cacheDir?.let { cache(Cache(File(it, "wertis_http"), 20L * 1024 * 1024)) } }
        .addInterceptor(hostSelection)
        .addInterceptor(IdentityHeaderInterceptor(currentUser, sessionToken, deviceId))
        /* PO `hostSelection`, bo dopiero on wpisuje prawdziwy adres — przed nim
           w żądaniu stoi atrapa `http://wertis.invalid/`. Sama ŚCIEŻKA jest co
           prawda ta sama przed i po przepisaniu, ale zależność od kolejności,
           która akurat działa, jest zależnością do złamania przy pierwszej
           zmianie w tamtym interceptorze. */
        .addInterceptor(LimityCzasuInterceptor())
        .build()

    /**
     * Wyrzuca z puli połączenia otwarte do POPRZEDNIEJ drogi sieciowej.
     *
     * Po przeskoku między punktami dostępowymi gniazda do starego AP zostają
     * w puli jako z pozoru żywe: pakiet wychodzi, odpowiedź nie wraca, a żądanie
     * stoi do timeoutu odczytu — czyli dziesięć sekund na każdą próbę. Ekran
     * wygląda wtedy jak zerwana łączność, choć sieć jest.
     *
     * `evictAll` zamyka WYŁĄCZNIE połączenia bezczynne, więc żądanie w locie
     * nie zostaje przerwane w połowie. Następne otworzy świeże gniazdo — to
     * samo, co dawało ręczne rozłączenie i połączenie Wi-Fi.
     */
    fun zerwijPolaczenia() {
        runCatching { okHttp.connectionPool.evictAll() }
    }

    val service: ApiService = Retrofit.Builder()
        .baseUrl("http://wertis.invalid/") // zawsze nadpisywany przez HostSelectionInterceptor
        .client(okHttp)
        .addConverterFactory(WertisJson.asConverterFactory("application/json".toMediaType()))
        .build()
        .create(ApiService::class.java)

    fun setBaseUrl(url: String) {
        hostSelection.baseUrl = url.toHttpUrlOrNull()
        // stary adres ma też stare gniazda — z nowym serwerem nie mają nic wspólnego
        zerwijPolaczenia()
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
    var powod: String? = null
    var eanPrzed: String? = null
    var kod: String? = null
    try {
        val raw = response()?.errorBody()?.string()
        if (!raw.isNullOrBlank()) {
            val body = WertisJson.decodeFromString(ApiErrorBody.serializer(), raw)
            body.error?.let { msg = it }
            available = body.available
            powod = body.powod
            eanPrzed = body.eanPrzed
            kod = body.kod
        }
    } catch (_: Exception) {
        /* brak treści / nie-JSON */
    }
    return when {
        available != null -> MmConflict(status, msg, available)
        // odmowa nadania kodu niesie POWÓD, bo `podmiana` i `zajety` prowadzą
        // w przeciwne strony: pierwszą da się przejść, drugiej nie
        powod != null -> EanOdmowa(status, msg, powod, eanPrzed)
        else -> ApiError(status, msg, kod)
    }
}
