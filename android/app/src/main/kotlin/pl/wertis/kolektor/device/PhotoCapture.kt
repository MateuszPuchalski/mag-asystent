package pl.wertis.kolektor.device

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.Uri
import android.util.Base64
import androidx.core.content.FileProvider
import java.io.ByteArrayOutputStream
import java.io.File
import kotlin.math.max
import kotlin.math.roundToInt

/* ── Zdjęcie dowodowe do zgłoszenia wyjątku (§4.6) ───────────────────────────
   Zdjęcie robi systemowy aparat (ACTION_IMAGE_CAPTURE) — nie wciągamy CameraX
   dla jednego kadru, a kolektor i tak ma aparat producenta.

   Plik ląduje w cache aplikacji i jest kasowany zaraz po zakodowaniu: dowód
   żyje na serwerze, przy dostawie, a nie w pamięci kolektora, którą ktoś kiedyś
   wyczyści.                                                                   */

/** Maksymalny bok po skalowaniu — czytelna etykieta i rozbity karton, ~200 KB. */
private const val MAX_EDGE = 1280

/** Jakość JPEG: 70 to granica, poniżej której artefakty zjadają druk na kartonie. */
private const val JPEG_QUALITY = 70

object PhotoCapture {

    /** Nowy plik docelowy dla aparatu + URI dzielone przez FileProvider. */
    fun newTarget(context: Context): Pair<File, Uri> {
        val dir = File(context.cacheDir, "photos").apply { mkdirs() }
        val file = File(dir, "problem-${System.currentTimeMillis()}.jpg")
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.photos", file)
        return file to uri
    }

    /**
     * Wczytaj, obróć wg EXIF, przeskaluj i zakoduj do base64 (bez nagłówka
     * data:). Zwraca `null`, gdy pliku nie da się odczytać — wołający pokazuje
     * komunikat zamiast wysyłać puste zgłoszenie.
     */
    fun encode(file: File): String? {
        if (!file.exists() || file.length() == 0L) return null
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(file.absolutePath, bounds)
        val longest = max(bounds.outWidth, bounds.outHeight)
        if (longest <= 0) return null

        // dekodujemy od razu pomniejszone — pełny kadr z 13 Mpx nie mieści się
        // w pamięci taniego kolektora
        val opts = BitmapFactory.Options().apply {
            inSampleSize = generateSequence(1) { it * 2 }.first { longest / it <= MAX_EDGE * 2 }
        }
        val raw = BitmapFactory.decodeFile(file.absolutePath, opts) ?: return null
        val rotated = applyExifRotation(file, raw)
        val scaled = scaleDown(rotated)

        val out = ByteArrayOutputStream()
        scaled.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, out)
        if (scaled !== rotated) scaled.recycle()
        if (rotated !== raw) rotated.recycle()
        raw.recycle()
        return Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
    }

    /** Kadr zrobiony bokiem musi trafić do reklamacji bokiem do góry. */
    private fun applyExifRotation(file: File, bmp: Bitmap): Bitmap {
        val degrees = runCatching {
            when (ExifInterface(file.absolutePath).getAttributeInt(
                ExifInterface.TAG_ORIENTATION,
                ExifInterface.ORIENTATION_NORMAL,
            )) {
                ExifInterface.ORIENTATION_ROTATE_90 -> 90f
                ExifInterface.ORIENTATION_ROTATE_180 -> 180f
                ExifInterface.ORIENTATION_ROTATE_270 -> 270f
                else -> 0f
            }
        }.getOrDefault(0f)
        if (degrees == 0f) return bmp
        val m = Matrix().apply { postRotate(degrees) }
        return Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, m, true)
    }

    private fun scaleDown(bmp: Bitmap): Bitmap {
        val longest = max(bmp.width, bmp.height)
        if (longest <= MAX_EDGE) return bmp
        val ratio = MAX_EDGE.toFloat() / longest
        return Bitmap.createScaledBitmap(
            bmp,
            (bmp.width * ratio).roundToInt().coerceAtLeast(1),
            (bmp.height * ratio).roundToInt().coerceAtLeast(1),
            true,
        )
    }

    /** Sprzątanie po nieudanym/porzuconym kadrze. */
    fun discard(file: File?) {
        runCatching { file?.delete() }
    }
}
