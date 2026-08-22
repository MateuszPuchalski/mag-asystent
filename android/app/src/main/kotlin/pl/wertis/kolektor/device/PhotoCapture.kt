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

/* ── Zdjęcie KARTOTEKI jedzie ostrzej niż dowodowe (0.88.0) ──────────────────
   Dowód do reklamacji ma pokazać rozbity karton i druk na etykiecie; 1280 px
   i jakość 70 wystarczają, a mniejszy plik szybciej wychodzi z hali.

   Zdjęcie kartoteki idzie do modelu, który TNIE PO KRAWĘDZIACH przedmiotu.
   Artefakty JPEG-a robią z krawędzi strzępy, a strzępy zostają w wyciętym
   obrazie na zawsze — także po tym, jak zdjęcie trafi do Subiekta. Te dwie
   liczby są więc ceną za wynik, a nie rozrzutnością.                          */

/** Maksymalny bok zdjęcia kartoteki. */
const val KARTOTEKA_MAX_EDGE = 1600

/** Jakość JPEG zdjęcia kartoteki. */
const val KARTOTEKA_JPEG_QUALITY = 85

object PhotoCapture {

    /**
     * Nowy plik docelowy dla aparatu + URI dzielone przez FileProvider.
     *
     * @param prefiks nazwa pliku roboczego. Nie ma wpływu na nic poza logiem —
     *   plik ginie zaraz po zakodowaniu — ale przy zaglądaniu do `cacheDir`
     *   od razu widać, czy porzucony kadr był dowodem, czy zdjęciem kartoteki.
     */
    fun newTarget(context: Context, prefiks: String = "problem"): Pair<File, Uri> {
        val dir = File(context.cacheDir, "photos").apply { mkdirs() }
        val file = File(dir, "$prefiks-${System.currentTimeMillis()}.jpg")
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.photos", file)
        return file to uri
    }

    /**
     * Wczytaj, obróć wg EXIF, przeskaluj i zakoduj do base64 (bez nagłówka
     * data:). Zwraca `null`, gdy pliku nie da się odczytać — wołający pokazuje
     * komunikat zamiast wysyłać puste zgłoszenie.
     */
    fun encode(file: File, maxEdge: Int = MAX_EDGE, quality: Int = JPEG_QUALITY): String? {
        if (!file.exists() || file.length() == 0L) return null
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(file.absolutePath, bounds)
        val longest = max(bounds.outWidth, bounds.outHeight)
        if (longest <= 0) return null

        // dekodujemy od razu pomniejszone — pełny kadr z 13 Mpx nie mieści się
        // w pamięci taniego kolektora
        val opts = BitmapFactory.Options().apply {
            inSampleSize = generateSequence(1) { it * 2 }.first { longest / it <= maxEdge * 2 }
        }
        val raw = BitmapFactory.decodeFile(file.absolutePath, opts) ?: return null
        val rotated = applyExifRotation(runCatching { ExifInterface(file.absolutePath) }.getOrNull(), raw)
        return dokoncz(raw, rotated, maxEdge, quality)
    }

    /**
     * To samo dla zdjęcia WYBRANEGO Z GALERII (0.88.0).
     *
     * Galeria oddaje `Uri`, nie plik — zdjęcie może leżeć na karcie SD, w chmurze
     * albo za innym providerem, więc ścieżki do niego nie ma i nie będzie.
     * Strumień otwieramy DWA RAZY: raz po same wymiary, raz po piksele. Bez
     * pierwszego przejścia kadr z 13 Mpx dekodowałby się w całości, a kolektor
     * jest tani — to ta sama ostrożność, którą `encode` stosuje do pliku.
     *
     * EXIF czytamy z TRZECIEGO strumienia i tylko wtedy, gdy da się go otworzyć.
     * Zdjęcie zrobione bokiem musi trafić do kartoteki bokiem do góry, a wybór
     * z galerii to najczęstsza droga dla zdjęcia zrobionego kiedyś indziej.
     */
    fun encodeUri(
        context: Context,
        uri: Uri,
        maxEdge: Int = MAX_EDGE,
        quality: Int = JPEG_QUALITY,
    ): String? {
        val cr = context.contentResolver
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        runCatching { cr.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) } }
            .getOrNull()
        val longest = max(bounds.outWidth, bounds.outHeight)
        if (longest <= 0) return null

        val opts = BitmapFactory.Options().apply {
            inSampleSize = generateSequence(1) { it * 2 }.first { longest / it <= maxEdge * 2 }
        }
        val raw = runCatching { cr.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, opts) } }
            .getOrNull() ?: return null
        val exif = runCatching { cr.openInputStream(uri)?.use { ExifInterface(it) } }.getOrNull()
        return dokoncz(raw, applyExifRotation(exif, raw), maxEdge, quality)
    }

    /** Wspólny ogon obu dróg: skalowanie, kompresja, base64, sprzątanie bitmap. */
    private fun dokoncz(raw: Bitmap, rotated: Bitmap, maxEdge: Int, quality: Int): String {
        val scaled = scaleDown(rotated, maxEdge)
        val out = ByteArrayOutputStream()
        scaled.compress(Bitmap.CompressFormat.JPEG, quality, out)
        if (scaled !== rotated) scaled.recycle()
        if (rotated !== raw) rotated.recycle()
        raw.recycle()
        return Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
    }

    /** Kadr zrobiony bokiem musi trafić do reklamacji bokiem do góry. */
    private fun applyExifRotation(exif: ExifInterface?, bmp: Bitmap): Bitmap {
        if (exif == null) return bmp
        val degrees = runCatching {
            when (exif.getAttributeInt(
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

    private fun scaleDown(bmp: Bitmap, maxEdge: Int): Bitmap {
        val longest = max(bmp.width, bmp.height)
        if (longest <= maxEdge) return bmp
        val ratio = maxEdge.toFloat() / longest
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
