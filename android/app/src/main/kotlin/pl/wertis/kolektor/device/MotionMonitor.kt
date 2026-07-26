package pl.wertis.kolektor.device

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.SystemClock
import kotlin.math.sqrt

/* ── Akcelerometr: log upadków ──────────────────────────────────────────────
   Swobodne spadanie + uderzenie → wpis audytowy device_drop (serwis widzi,
   który kolektor obrywa).

   Było tu też shake-to-COFNIJ, ale gest działał wyłącznie w oknie karencji
   zapisu — a karencja zniknęła razem z paskiem COFNIJ.                       */

private const val FREEFALL_MAG = 3f // m/s² — blisko zera podczas spadania
private const val FREEFALL_MIN_MS = 250L
private const val IMPACT_MAG = 30f
private const val DROP_DEBOUNCE_MS = 5000L

class MotionMonitor(
    context: Context,
    private val dropLogEnabled: () -> Boolean,
    private val onDrop: (fallMs: Long) -> Unit,
) : SensorEventListener {

    private val sensorManager = context.getSystemService(Context.SENSOR_SERVICE) as SensorManager
    private val accel: Sensor? = sensorManager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)

    private var freefallStart: Long? = null
    private var lastDrop = 0L

    fun start() {
        accel?.let { sensorManager.registerListener(this, it, SensorManager.SENSOR_DELAY_GAME) }
    }

    fun stop() {
        sensorManager.unregisterListener(this)
    }

    override fun onSensorChanged(event: SensorEvent) {
        val (x, y, z) = event.values
        val mag = sqrt(x * x + y * y + z * z)
        val now = SystemClock.elapsedRealtime()

        // swobodne spadanie → uderzenie = upadek urządzenia
        if (dropLogEnabled()) {
            if (mag < FREEFALL_MAG) {
                if (freefallStart == null) freefallStart = now
            } else {
                val start = freefallStart
                if (start != null && now - start > FREEFALL_MIN_MS && mag > IMPACT_MAG && now - lastDrop > DROP_DEBOUNCE_MS) {
                    lastDrop = now
                    onDrop(now - start)
                }
                freefallStart = null
            }
        }
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}
}

private operator fun FloatArray.component1() = this[0]
private operator fun FloatArray.component2() = this[1]
private operator fun FloatArray.component3() = this[2]
