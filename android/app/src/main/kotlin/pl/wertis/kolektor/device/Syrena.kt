package pl.wertis.kolektor.device

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import kotlin.math.PI
import kotlin.math.sin

/* ── Syrena zgubionego kolektora ────────────────────────────────────────────
   Dźwięk, po którym idzie się przez halę do kolektora odłożonego na regale.
   Trzy decyzje, każda przeciw temu, co robi zwykły sygnał skanu w `Feedback`:

   1. STRUMIEŃ ALARMU, NIE SYSTEMOWY. Kolektory bywają ściszone do zera, a to
      ściszenie dotyczy strumieni, po których grają sygnały skanu. Alarm ma
      własną głośność; podnosimy ją na czas syreny do maksimum i oddajemy
      potem dokładnie tę, którą zastaliśmy.

   2. ŚWIERGOT, NIE CZYSTY TON. Ucho namierza kierunek po zmianie wysokości
      i po ostrym początku dźwięku. Stały ton odbija się od metalowych
      regałów i „dochodzi zewsząd". Przejście 900 → 2600 Hz ma oba te
      składniki i przebija szum wózków.

   3. PĘTLA W JEDNYM BUFORZE. Wzór trwa ~1,2 s i gra go sam AudioTrack
      w pętli — bez wątku, który budziłby procesor co takt i zjadał baterię
      urządzenia, które i tak może jej mieć mało.                              */

private const val PROBKOWANIE = 22_050

class Syrena(context: Context) {
    private val audio = context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
    private val vibrator: Vibrator? =
        if (Build.VERSION.SDK_INT >= 31) {
            (context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? android.os.VibratorManager)
                ?.defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            context.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
        }

    private var track: AudioTrack? = null
    private var glosnoscPrzed: Int? = null

    val gra: Boolean @Synchronized get() = track != null

    @Synchronized
    fun wlacz() {
        if (track != null) return
        audio?.let { a ->
            runCatching {
                glosnoscPrzed = a.getStreamVolume(AudioManager.STREAM_ALARM)
                a.setStreamVolume(AudioManager.STREAM_ALARM, a.getStreamMaxVolume(AudioManager.STREAM_ALARM), 0)
            }
            // tryb „nie przeszkadzać" potrafi odmówić zmiany głośności
            // wyjątkiem — wtedy gramy na tej, która jest
        }
        track = runCatching { zbudujTor() }.getOrNull()?.also { it.play() }
        runCatching {
            // długi impuls i przerwa w pętli: czuć w dłoni, która już sięga
            vibrator?.vibrate(VibrationEffect.createWaveform(longArrayOf(0, 600, 400), 1))
        }
    }

    @Synchronized
    fun wylacz() {
        track?.let { t ->
            runCatching { t.stop() }
            runCatching { t.release() }
        }
        track = null
        runCatching { vibrator?.cancel() }
        val przed = glosnoscPrzed
        if (przed != null) {
            runCatching { audio?.setStreamVolume(AudioManager.STREAM_ALARM, przed, 0) }
        }
        glosnoscPrzed = null
    }

    private fun zbudujTor(): AudioTrack {
        val wzor = wzorSyreny()
        val t = AudioTrack(
            AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ALARM)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build(),
            AudioFormat.Builder()
                .setSampleRate(PROBKOWANIE)
                .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                .build(),
            wzor.size * 2,
            AudioTrack.MODE_STATIC,
            0,
        )
        t.write(wzor, 0, wzor.size)
        t.setLoopPoints(0, wzor.size, -1)
        return t
    }

    /** Dwa świergoty po 300 ms, przerwa 100 ms między nimi i 500 ms ciszy. */
    private fun wzorSyreny(): ShortArray {
        val swiergot = 300
        val probki = { ms: Int -> PROBKOWANIE * ms / 1000 }
        val wynik = ShortArray(probki(swiergot + 100 + swiergot + 500))
        var faza = 0.0
        fun graj(odProbki: Int) {
            val n = probki(swiergot)
            for (i in 0 until n) {
                val postep = i.toDouble() / n
                val f = 900.0 + (2600.0 - 900.0) * postep
                faza += 2 * PI * f / PROBKOWANIE
                // krótkie wejście i zejście — bez nich głośnik trzaska na
                // krawędzi, a trzask w pętli brzmi jak awaria, nie jak wołanie
                val obwiednia = minOf(1.0, i / 200.0, (n - i) / 200.0)
                wynik[odProbki + i] = (sin(faza) * obwiednia * 0.9 * Short.MAX_VALUE).toInt().toShort()
            }
        }
        graj(0)
        graj(probki(swiergot + 100))
        return wynik
    }
}
