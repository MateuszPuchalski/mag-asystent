package pl.wertis.kolektor.device

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.SystemClock
import kotlin.math.sqrt

/* ── Akcelerometr — port web/src/lib/motion.ts ──────────────────────────────
   1. Shake-to-COFNIJ: potrząśnięcie cofa ostatni auto-zapis — aktywne TYLKO
      gdy widoczny jest pasek COFNIJ (okno karencji), więc ruch przy chodzeniu
      i odkładaniu urządzenia niczego nie psuje.
   2. Log upadków: swobodne spadanie + uderzenie → wpis audytowy device_drop
      (serwis widzi, który kolektor obrywa).                                   */

private const val SHAKE_MAG = 25f // m/s² — energiczne potrząśnięcie
private const val SHAKE_SAMPLES = 3
private const val SHAKE_WINDOW_MS = 400L
private const val SHAKE_DEBOUNCE_MS = 1500L

private const val FREEFALL_MAG = 3f // m/s² — blisko zera podczas spadania
private const val FREEFALL_MIN_MS = 250L
private const val IMPACT_MAG = 30f
private const val DROP_DEBOUNCE_MS = 5000L

class MotionMonitor(
    context: Context,
    private val shakeEnabled: () -> Boolean,
    private val dropLogEnabled: () -> Boolean,
    /** Czy pasek COFNIJ jest widoczny (okno karencji). */
    private val undoVisible: () -> Boolean,
    private val onShakeUndo: () -> Unit,
    private val onDrop: (fallMs: Long) -> Unit,
) : SensorEventListener {

    private val sensorManager = context.getSystemService(Context.SENSOR_SERVICE) as SensorManager
    private val accel: Sensor? = sensorManager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)

    private val spikes = ArrayDeque<Long>()
    private var lastShake = 0L
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

        // shake → COFNIJ (tylko w oknie karencji)
        if (shakeEnabled() && mag > SHAKE_MAG) {
            while (spikes.isNotEmpty() && now - spikes.first() >= SHAKE_WINDOW_MS) spikes.removeFirst()
            spikes.addLast(now)
            if (spikes.size >= SHAKE_SAMPLES && now - lastShake > SHAKE_DEBOUNCE_MS && undoVisible()) {
                lastShake = now
                spikes.clear()
                onShakeUndo()
            }
        }

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
