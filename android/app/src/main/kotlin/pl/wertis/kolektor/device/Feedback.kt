package pl.wertis.kolektor.device

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import kotlin.concurrent.thread
import kotlin.math.PI
import kotlin.math.sin

/* ── Sygnały skanu: beep + wibracja — port web/src/lib/feedback.ts ──────────
   OK: 1400 Hz + wibracja 40 ms; błąd: 320 Hz + wzór [60,40,60]. Ton ~160 ms
   z wykładniczym wygaszeniem, syntetyzowany do AudioTrack (jak WebAudio).    */

class Feedback(context: Context) {
    private val vibrator: Vibrator? =
        if (Build.VERSION.SDK_INT >= 31) {
            val vm = context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE)
                as? android.os.VibratorManager
            vm?.defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            context.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
        }

    fun beep(ok: Boolean = true) {
        playTone(if (ok) 1400.0 else 320.0)
        vibrate(ok)
    }

    private fun vibrate(ok: Boolean) {
        val v = vibrator ?: return
        try {
            val effect = if (ok) {
                VibrationEffect.createOneShot(40, VibrationEffect.DEFAULT_AMPLITUDE)
            } else {
                VibrationEffect.createWaveform(longArrayOf(0, 60, 40, 60), -1)
            }
            v.vibrate(effect)
        } catch (_: Exception) {
            /* brak wibratora */
        }
    }

    private fun playTone(freq: Double) {
        thread(isDaemon = true, name = "wertis-beep") {
            try {
                val sampleRate = 22050
                val durationMs = 160
                val samples = sampleRate * durationMs / 1000
                val buf = ShortArray(samples)
                for (i in 0 until samples) {
                    val t = i.toDouble() / sampleRate
                    val env = Math.exp(-t / 0.055) // wygaszenie ~ jak decay 0.16 s
                    buf[i] = (sin(2 * PI * freq * t) * env * 0.35 * Short.MAX_VALUE).toInt().toShort()
                }
                val track = AudioTrack(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ASSISTANCE_SONIFICATION)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build(),
                    AudioFormat.Builder()
                        .setSampleRate(sampleRate)
                        .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                        .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                        .build(),
                    buf.size * 2,
                    AudioTrack.MODE_STATIC,
                    0,
                )
                track.write(buf, 0, buf.size)
                track.play()
                Thread.sleep(durationMs + 60L)
                track.release()
            } catch (_: Exception) {
                /* brak audio — wibracja wystarczy */
            }
        }
    }
}
