package pl.wertis.kolektor.scan

import android.app.Activity

/** Źródło skanów sprzętowych; start/stop spinane z onResume/onPause. */
interface ScannerSource {
    fun start(activity: Activity)
    fun stop(activity: Activity)
}
