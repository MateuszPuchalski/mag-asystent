package pl.wertis.kolektor.data

import android.content.Context
import android.graphics.BitmapFactory
import android.util.AtomicFile
import java.io.File
import java.io.ByteArrayOutputStream
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.builtins.MapSerializer
import kotlinx.serialization.builtins.serializer
import okhttp3.HttpUrl.Companion.toHttpUrl
import pl.wertis.kolektor.core.net.WertisJson
import pl.wertis.kolektor.core.product.PhotoCache
import pl.wertis.kolektor.core.product.PhotoImage
import pl.wertis.kolektor.core.product.PhotoReply
import pl.wertis.kolektor.core.product.PhotoStore
import pl.wertis.kolektor.core.product.WpisZdjecia
import pl.wertis.kolektor.net.ApiClient

private const val MAX_PHOTO_BYTES = 4 * 1024 * 1024

/** Pliki pozostają w filesDir dla podglądu bez zasięgu. Nowy indeks nie
 * przejmuje starych zdjęć: nie da się ustalić, z którego serwera pochodzą. */
private class AndroidPhotoStore(context: Context) : PhotoStore {
    private val directory = File(context.filesDir, "zdjecia").apply { mkdirs() }
    private val prefs = context.getSharedPreferences("wertis_zdjecia_v2", Context.MODE_PRIVATE)
    private val serializer = MapSerializer(String.serializer(), WpisZdjecia.serializer())
    private val validKey = Regex("[a-f0-9]{64}-t[0-9]+")
    private fun file(key: String): File {
        require(validKey.matches(key))
        return File(directory, "$key.img")
    }
    override suspend fun index(): Map<String, WpisZdjecia> = withContext(Dispatchers.IO) {
        // Usuwamy tylko poprzedni, jednoznacznie nazwany cache zdjęć aplikacji.
        directory.listFiles()?.filter { Regex("t[0-9]+\\.img").matches(it.name) }?.forEach { it.delete() }
        val raw = prefs.getString("index", null) ?: return@withContext emptyMap()
        runCatching { WertisJson.decodeFromString(serializer, raw).filterKeys(validKey::matches) }.getOrDefault(emptyMap())
    }
    override suspend fun saveIndex(index: Map<String, WpisZdjecia>): Unit = withContext(Dispatchers.IO) {
        check(prefs.edit().putString("index", WertisJson.encodeToString(serializer, index)).commit()) { "Nie można zapisać indeksu zdjęć" }
    }
    override suspend fun read(key: String): ByteArray? = withContext(Dispatchers.IO) {
        val f = file(key)
        if (!f.exists() || f.length() !in 1..MAX_PHOTO_BYTES.toLong()) return@withContext null
        val bytes = AtomicFile(f).openRead().use { it.readBytes() }
        if (validPhoto(bytes)) bytes else null
    }
    override suspend fun write(key: String, bytes: ByteArray): Unit = withContext(Dispatchers.IO) {
        val atomic = AtomicFile(file(key))
        val stream = atomic.startWrite()
        try { stream.write(bytes); stream.fd.sync(); atomic.finishWrite(stream) }
        catch (e: Exception) { atomic.failWrite(stream); throw e }
    }
    override suspend fun remove(key: String): Unit = withContext(Dispatchers.IO) { AtomicFile(file(key)).delete() }
}

private fun validPhoto(bytes: ByteArray): Boolean {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    return bounds.outWidth > 0 && bounds.outHeight > 0
}

class ZdjeciaRepository(
    context: Context,
    private val apiClient: ApiClient,
    private val settings: SettingsRepository,
    private val sessionToken: () -> String?,
) {
    fun source(): String = settings.current.serverUrl.toHttpUrl().newBuilder()
        .encodedPath("/").query(null).fragment(null).build().toString()

    private val cache = PhotoCache(AndroidPhotoStore(context), ::source, fetch = { server, id, etag ->
        check(server == source()) { "Zmieniło się źródło zdjęć" }
        val api = apiClient.fixedService(server, sessionToken())
        val reply = api.zdjecie(id, etag)
        // Każda ścieżka zamyka odpowiedź. Limit działa również wtedy, gdy
        // serwer nie podał Content-Length lub zwrócił błędną treść.
        try {
            withContext(Dispatchers.IO) {
                if (reply.code() != 200) PhotoReply(reply.code())
                else {
                    val bytes = reply.body()?.byteStream()?.use { stream ->
                        val out = ByteArrayOutputStream()
                        val buffer = ByteArray(8192)
                        while (out.size() <= MAX_PHOTO_BYTES) {
                            val count = stream.read(buffer, 0, minOf(buffer.size, MAX_PHOTO_BYTES + 1 - out.size()))
                            if (count <= 0) break
                            out.write(buffer, 0, count)
                        }
                        out.toByteArray()
                     }
                    if (bytes == null || bytes.size > MAX_PHOTO_BYTES || !validPhoto(bytes)) PhotoReply(502)
                    else PhotoReply(200, bytes, reply.headers()["ETag"].orEmpty())
                }
            }
        } finally { reply.body()?.close(); reply.errorBody()?.close() }
    })

    suspend fun zdjecie(twId: Long): PhotoImage? = cache.get(source(), twId)
    suspend fun zapomnij(twId: Long) = cache.forget(source(), twId)
}

/**
 * Dekodowanie do rozmiaru, który naprawdę jest rysowany.
 *
 * Bitmapa 1024×1024 w ARGB_8888 to 4 MB — trzy takie naraz na tanim kolektorze
 * kończą się `OutOfMemoryError`. Miniatura w slocie 76 dp nie potrzebuje
 * niczego powyżej ~200 px, więc schodzimy `inSampleSize` (ta sama technika co
 * `PhotoCapture.encode` i `ProblemSheet.thumbOpts`).
 */
suspend fun dekodujDo(bajty: ByteArray, docelowyPx: Int): android.graphics.Bitmap? =
    withContext(Dispatchers.IO) {
        runCatching {
            val wymiary = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeByteArray(bajty, 0, bajty.size, wymiary)
            var probka = 1
            var wiekszyBok = maxOf(wymiary.outWidth, wymiary.outHeight)
            while (wiekszyBok / 2 >= docelowyPx) {
                probka *= 2
                wiekszyBok /= 2
            }
            BitmapFactory.decodeByteArray(bajty, 0, bajty.size, BitmapFactory.Options().apply {
                inSampleSize = probka
            })
        }.getOrNull()
    }
