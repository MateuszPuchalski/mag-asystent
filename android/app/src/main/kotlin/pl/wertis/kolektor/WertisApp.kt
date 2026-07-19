package pl.wertis.kolektor

import android.app.Application
import android.content.Context
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import pl.wertis.kolektor.core.net.DeviceEventBody
import pl.wertis.kolektor.data.LocationsRepository
import pl.wertis.kolektor.data.QueueRepository
import pl.wertis.kolektor.data.RecentStore
import pl.wertis.kolektor.data.SettingsRepository
import pl.wertis.kolektor.data.UsersRepository
import pl.wertis.kolektor.device.BatteryAssist
import pl.wertis.kolektor.device.ConnectivityMonitor
import pl.wertis.kolektor.device.Feedback
import pl.wertis.kolektor.device.MotionMonitor
import pl.wertis.kolektor.nav.AppNavState
import pl.wertis.kolektor.net.ApiClient
import pl.wertis.kolektor.offline.ApiOpSender
import pl.wertis.kolektor.offline.FileOpStorage
import pl.wertis.kolektor.offline.wireOfflineFlush
import pl.wertis.kolektor.core.offline.OfflineQueue
import pl.wertis.kolektor.scan.ScannerManager
import pl.wertis.kolektor.ui.chrome.UiEffects
import pl.wertis.kolektor.undo.UndoManager

/* ── Kompozycja aplikacji — ręczny service locator (bez DI frameworka) ──────
   ~10 singletonów; ViewModel-e dostają graf przez viewModelFactory helper.   */

class AppGraph(context: Context) {
    val appScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    val settings = SettingsRepository(context)
    val users = UsersRepository(context)
    val recent = RecentStore(context)

    val apiClient = ApiClient(
        currentUser = { users.currentUser },
        initialBaseUrl = settings.current.serverUrl,
    )
    val api get() = apiClient.service

    val connectivity = ConnectivityMonitor(context)
    val queueRepo = QueueRepository(api, appScope)
    val locationsRepo = LocationsRepository(api)

    val effects = UiEffects(appScope)
    val nav = AppNavState(recent)
    val feedback = Feedback(context)

    val offlineQueue = OfflineQueue(
        storage = FileOpStorage(context),
        sender = ApiOpSender(api),
        isOnline = { connectivity.isOnline },
        onRejected = { _, msg -> effects.toast("Operacja z bufora odrzucona: $msg") },
    )

    val undo = UndoManager(api, offlineQueue, queueRepo, effects)
    val scanner = ScannerManager(context)

    val motion = MotionMonitor(
        context,
        shakeEnabled = { settings.current.shakeUndo },
        dropLogEnabled = { settings.current.dropLog },
        undoVisible = { effects.undo.value != null },
        onShakeUndo = { appScope.launch { undo.performUndo() } },
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
