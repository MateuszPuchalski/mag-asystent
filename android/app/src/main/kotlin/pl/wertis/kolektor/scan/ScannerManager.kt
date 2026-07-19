package pl.wertis.kolektor.scan

import android.app.Activity
import android.content.Context
import android.os.Build

/* ── Wybór źródeł skanera wg producenta urządzenia ──────────────────────────
   Honeywell: DataCollection SDK (opcjonalny AAR). Zebra: DataWedge (intenty).
   Wedge klawiaturowy działa zawsze jako fallback (obsługiwany bezpośrednio
   w MainActivity.dispatchKeyEvent, nie przez ScannerSource).                 */

class ScannerManager(context: Context) {
    private val sources: List<ScannerSource> = buildList {
        val m = Build.MANUFACTURER.lowercase()
        if ("honeywell" in m) {
            HoneywellSource.createIfAvailable(context)?.let { add(it) }
        }
        if ("zebra" in m || "motorola solutions" in m || "symbol" in m) {
            add(ZebraDataWedgeSource(context))
        }
    }

    fun start(activity: Activity) = sources.forEach { it.start(activity) }
    fun stop(activity: Activity) = sources.forEach { it.stop(activity) }
}
