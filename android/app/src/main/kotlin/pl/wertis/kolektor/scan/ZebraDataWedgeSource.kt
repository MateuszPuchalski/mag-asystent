package pl.wertis.kolektor.scan

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.os.Bundle
import pl.wertis.kolektor.core.scan.classify

/* ── Zebra DataWedge — czyste intenty, bez SDK ──────────────────────────────
   Na starcie samo-prowizjonujemy profil WERTIS (BARCODE→INTENT, wyjście
   klawiaturowe wyłączone), a skany odbieramy broadcastem SCAN_ACTION.
   Gdy DataWedge jest zablokowany przez MDM, profil można skonfigurować
   ręcznie — instrukcja w android/README.md.                                  */

class ZebraDataWedgeSource(private val context: Context) : ScannerSource {

    private val receiver = object : BroadcastReceiver() {
        override fun onReceive(ctx: Context, intent: Intent) {
            val data = intent.getStringExtra("com.symbol.datawedge.data_string") ?: return
            if (data.isNotBlank()) ScannerBus.dispatch(classify(data))
        }
    }
    private var registered = false

    override fun start(activity: Activity) {
        if (!registered) {
            val filter = IntentFilter(SCAN_ACTION)
            if (Build.VERSION.SDK_INT >= 33) {
                context.registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED)
            } else {
                @Suppress("UnspecifiedRegisterReceiverFlag")
                context.registerReceiver(receiver, filter)
            }
            registered = true
        }
        provisionProfile()
    }

    override fun stop(activity: Activity) {
        if (registered) {
            runCatching { context.unregisterReceiver(receiver) }
            registered = false
        }
    }

    /** SET_CONFIG: profil WERTIS z pluginem BARCODE + INTENT (broadcast). */
    private fun provisionProfile() {
        val profile = Bundle().apply {
            putString("PROFILE_NAME", PROFILE)
            putString("PROFILE_ENABLED", "true")
            putString("CONFIG_MODE", "CREATE_IF_NOT_EXIST")
            putParcelableArray(
                "APP_LIST",
                arrayOf(
                    Bundle().apply {
                        putString("PACKAGE_NAME", context.packageName)
                        putStringArray("ACTIVITY_LIST", arrayOf("*"))
                    }
                ),
            )
            val barcode = Bundle().apply {
                putString("PLUGIN_NAME", "BARCODE")
                putString("RESET_CONFIG", "true")
                putBundle("PARAM_LIST", Bundle().apply { putString("scanner_selection", "auto") })
            }
            val intentOut = Bundle().apply {
                putString("PLUGIN_NAME", "INTENT")
                putString("RESET_CONFIG", "true")
                putBundle(
                    "PARAM_LIST",
                    Bundle().apply {
                        putString("intent_output_enabled", "true")
                        putString("intent_action", SCAN_ACTION)
                        putString("intent_delivery", "2") // broadcast
                    },
                )
            }
            val keystroke = Bundle().apply {
                putString("PLUGIN_NAME", "KEYSTROKE")
                putString("RESET_CONFIG", "true")
                putBundle("PARAM_LIST", Bundle().apply { putString("keystroke_output_enabled", "false") })
            }
            putParcelableArrayList("PLUGIN_CONFIG", arrayListOf(barcode, intentOut, keystroke))
        }
        context.sendBroadcast(
            Intent().apply {
                action = "com.symbol.datawedge.api.ACTION"
                putExtra("com.symbol.datawedge.api.SET_CONFIG", profile)
            }
        )
    }

    companion object {
        const val PROFILE = "WERTIS"
        const val SCAN_ACTION = "pl.wertis.kolektor.SCAN"
    }
}
