package pl.wertis.kolektor.offline

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import pl.wertis.kolektor.WertisApp

/** Dosłanie bufora offline z tła (constraint: sieć). */
class FlushWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val graph = (applicationContext as WertisApp).graph
        graph.offlineQueue.flush()
        return if (graph.offlineQueue.count.value > 0) Result.retry() else Result.success()
    }
}
