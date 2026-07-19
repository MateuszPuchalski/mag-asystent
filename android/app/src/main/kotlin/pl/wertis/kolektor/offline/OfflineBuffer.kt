package pl.wertis.kolektor.offline

import android.content.Context
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ProcessLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.builtins.ListSerializer
import pl.wertis.kolektor.core.net.WertisJson
import pl.wertis.kolektor.core.offline.OfflineQueue
import pl.wertis.kolektor.core.offline.OpSender
import pl.wertis.kolektor.core.offline.OpStorage
import pl.wertis.kolektor.core.offline.PendingOp
import pl.wertis.kolektor.device.ConnectivityMonitor
import pl.wertis.kolektor.net.ApiService
import pl.wertis.kolektor.net.apiCall

/* ── Sklejenie bufora offline (core) z Androidem ────────────────────────────
   Trwałość: plik JSON w filesDir (odpowiednik localStorage["wertis_offline"]).
   Wyzwalacze flusha jak w web/src/lib/offline.ts: powrót sieci, tyker 15 s
   (tylko na wierzchu), start aplikacji, przycisk „WYŚLIJ TERAZ”. WorkManager
   dosyła bufor, gdyby proces żył w tle.                                      */

/** Plikowy magazyn operacji (odpowiednik localStorage). */
class FileOpStorage(context: Context) : OpStorage {
    private val file = File(context.filesDir, "wertis_offline.json")
    private val serializer = ListSerializer(PendingOp.serializer())

    override fun load(): List<PendingOp> = try {
        if (file.exists()) WertisJson.decodeFromString(serializer, file.readText()) else emptyList()
    } catch (_: Exception) {
        emptyList()
    }

    override fun save(ops: List<PendingOp>) {
        try {
            file.writeText(WertisJson.encodeToString(serializer, ops))
        } catch (_: Exception) {
            /* pełny dysk — operacja zostaje przynajmniej w pamięci */
        }
    }
}

/** Wysyłka zbuforowanej operacji przez REST — z autorem z chwili zbuforowania. */
class ApiOpSender(private val api: ApiService) : OpSender {
    override suspend fun send(op: PendingOp): Long? = apiCall {
        when (op.kind) {
            PendingOp.OpKind.SET_LOCATION ->
                api.setLocation(requireNotNull(op.productId), requireNotNull(op.setLocation), asUser = op.user).queueId
            PendingOp.OpKind.MM ->
                api.mm(requireNotNull(op.mm), asUser = op.user).queueId
        }
    }
}

/** Podpięcie wyzwalaczy flusha; wołane raz z AppGraph. */
fun wireOfflineFlush(
    context: Context,
    queue: OfflineQueue,
    connectivity: ConnectivityMonitor,
    scope: CoroutineScope,
) {
    // powrót sieci
    connectivity.onAvailable = {
        scope.launch { queue.flush() }
        enqueueFlushWork(context)
    }
    // tyker 15 s + próba na starcie (tylko gdy aplikacja na wierzchu)
    scope.launch {
        ProcessLifecycleOwner.get().lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            while (true) {
                queue.flush()
                delay(15_000)
            }
        }
    }
    // siatka bezpieczeństwa w tle, gdy coś czeka
    scope.launch {
        queue.count.collect { if (it > 0) enqueueFlushWork(context) }
    }
}

private fun enqueueFlushWork(context: Context) {
    WorkManager.getInstance(context).enqueueUniqueWork(
        "wertis-offline-flush",
        ExistingWorkPolicy.KEEP,
        OneTimeWorkRequestBuilder<FlushWorker>()
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .build(),
    )
}
