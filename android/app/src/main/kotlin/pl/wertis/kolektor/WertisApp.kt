package pl.wertis.kolektor

import android.app.Application
import android.content.Context
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import pl.wertis.kolektor.core.net.DeviceEventBody
import pl.wertis.kolektor.data.TelemetryRepository
import pl.wertis.kolektor.data.LocationsRepository
import pl.wertis.kolektor.data.ProblemsRepository
import pl.wertis.kolektor.data.QueueRepository
import pl.wertis.kolektor.data.RecentStore
import pl.wertis.kolektor.data.SessionRepository
import pl.wertis.kolektor.data.SettingsRepository
import pl.wertis.kolektor.device.BatteryAssist
import pl.wertis.kolektor.device.ConnectivityMonitor
import pl.wertis.kolektor.device.Feedback
import pl.wertis.kolektor.device.MotionMonitor
import pl.wertis.kolektor.nav.AppNavState
import pl.wertis.kolektor.net.ApiClient
import pl.wertis.kolektor.net.ApiService
import pl.wertis.kolektor.offline.ApiOpSender
import pl.wertis.kolektor.offline.FileOpStorage
import pl.wertis.kolektor.offline.wireOfflineFlush
import pl.wertis.kolektor.core.offline.OfflineQueue
import pl.wertis.kolektor.scan.ScannerManager
import pl.wertis.kolektor.ui.chrome.UiEffects

/* ── Kompozycja aplikacji — ręczny service locator (bez DI frameworka) ──────
   ~10 singletonów; ViewModel-e dostają graf przez viewModelFactory helper.   */

class AppGraph(context: Context) {
    val appScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    val settings = SettingsRepository(context)
    val recent = RecentStore(context)

    /* Tożsamość rozstrzyga serwer na podstawie skanu badge'a (plan §7).
       Repozytorium powstaje PRZED klientem HTTP, bo klient musi umieć doczytać
       z niego token; `api` jedzie w drugą stronę jako lambda.

       TYPY SĄ TU JAWNE I MUSZĄ TAKIE ZOSTAĆ. Zależność jest cykliczna
       (session → api → apiClient → session) i wykonanie rozplątuje ją leniwie,
       ale WNIOSKOWANIE typów tego nie potrafi: kompilator kończy na
       „Type checking has run into a recursive problem". Adnotacja przecina
       cykl, bo typ `api` jest znany bez zaglądania do `apiClient`. */
    val session: SessionRepository = SessionRepository({ api }, appScope, context)

    val apiClient: ApiClient = ApiClient(
        currentUser = { session.currentUser },
        sessionToken = { session.token },
        deviceId = settings.deviceId,
        initialBaseUrl = settings.current.serverUrl,
    )
    val api: ApiService get() = apiClient.service

    val connectivity = ConnectivityMonitor(context)
    val queueRepo = QueueRepository(api, appScope)
    val locationsRepo = LocationsRepository(context, api)
    val problemsRepo = ProblemsRepository(api, appScope)

    val effects = UiEffects(appScope)
    val nav = AppNavState(recent)
    val feedback = Feedback(context)

    val offlineQueue = OfflineQueue(
        storage = FileOpStorage(context),
        sender = ApiOpSender(api),
        isOnline = { connectivity.isOnline },
        onRejected = { _, msg -> effects.toast("Operacja z bufora odrzucona: $msg") },
    )

    val telemetry = TelemetryRepository(api, appScope)

    val scanner = ScannerManager(context)

    val motion = MotionMonitor(
        context,
        dropLogEnabled = { settings.current.dropLog },
        onDrop = { fallMs ->
            appScope.launch {
                runCatching { api.deviceEvent(DeviceEventBody(type = "device_drop", magnitude = fallMs.toDouble())) }
            }
        },
    )

    val batteryAssist = BatteryAssist(
        context,
        enabled = { settings.current.batteryAssist },
        onLowBattery = { pct ->
            appScope.launch {
                offlineQueue.flush() // wypchnij bufor, zanim bateria padnie / hot-swap
                effects.toast("Niska bateria ($pct%) — wymień na zapasową")
                runCatching { api.deviceEvent(DeviceEventBody(type = "battery_low", level = pct.toDouble())) }
            }
        },
    )

    init {
        wireOfflineFlush(context, offlineQueue, connectivity, appScope)
        // nierozwiązane wyjątki od razu przy starcie (D8) — inaczej nikt ich nie ruszy
        problemsRepo.refresh()
        // reguła rozpoznawania kodu lokalizacji należy do serwera; do czasu jej
        // pobrania skaner pracuje ostrożnie (tylko prefiks LOC:), więc pierwszy
        // skan po starcie nie może na nią czekać
        appScope.launch { locationsRepo.get() }
        // blokada jest stanem serwera — pytamy o nią przy starcie, a nie
        // liczymy drugiego zegara po stronie kolektora
        session.refresh()
        // zmiana adresu serwera w Ustawieniach działa od ręki
        appScope.launch {
            settings.settings.collect { apiClient.setBaseUrl(it.serverUrl) }
        }
    }
}

class WertisApp : Application() {
    lateinit var graph: AppGraph
        private set

    override fun onCreate() {
        super.onCreate()
        graph = AppGraph(this)
    }
}

val Context.appGraph: AppGraph get() = (applicationContext as WertisApp).graph
