package pl.wertis.kolektor.device

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager

/* ── Asysta hot-swap przy niskiej baterii ───────────────────────────────────
   Kolektory mają wymienne baterie. Poniżej 15% (bez ładowania): wypchnij
   bufor offline, ostrzeż magazyniera i zaloguj battery_low do audytu.
   Reset ostrzeżenia po powrocie powyżej 30%.                                 */

private const val LOW_PCT = 15
private const val RESET_PCT = 30

class BatteryAssist(
    private val context: Context,
    private val enabled: () -> Boolean,
    private val onLowBattery: (pct: Int) -> Unit,
) {
    private var warned = false
    private var registered = false

    private val receiver = object : BroadcastReceiver() {
        override fun onReceive(ctx: Context, intent: Intent) {
            if (!enabled()) return
            val level = intent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
            val scale = intent.getIntExtra(BatteryManager.EXTRA_SCALE, 100)
            val status = intent.getIntExtra(BatteryManager.EXTRA_STATUS, -1)
            if (level < 0 || scale <= 0) return
            val pct = level * 100 / scale
            val charging = status == BatteryManager.BATTERY_STATUS_CHARGING ||
                status == BatteryManager.BATTERY_STATUS_FULL

            if (!charging && pct < LOW_PCT && !warned) {
                warned = true
                onLowBattery(pct)
            } else if (pct > RESET_PCT) {
                warned = false
            }
        }
    }

    fun start() {
        if (registered) return
        context.registerReceiver(receiver, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        registered = true
    }

    fun stop() {
        if (!registered) return
        runCatching { context.unregisterReceiver(receiver) }
        registered = false
    }
}
