package pl.wertis.kolektor.core.product

import java.security.MessageDigest
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

fun photoHash(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256").digest(bytes)
    .joinToString("") { "%02x".format(it) }

fun photoKey(server: String, id: Long): String = "${photoHash(server.toByteArray(Charsets.UTF_8))}-t$id"

/** Zmiana bajtów musi zmienić również klucz zdekodowanej miniatury. */
fun photoBitmapKey(id: Long, pixels: Int, bytes: ByteArray): String = "$id:$pixels:${photoHash(bytes)}"

data class PhotoImage(val bytes: ByteArray, val stale: Boolean = false)
data class PhotoReply(val status: Int, val bytes: ByteArray? = null, val etag: String = "")

interface PhotoStore {
    suspend fun index(): Map<String, WpisZdjecia>
    suspend fun saveIndex(index: Map<String, WpisZdjecia>)
    suspend fun read(key: String): ByteArray?
    suspend fun write(key: String, bytes: ByteArray)
    suspend fun remove(key: String)
}

/** Wspólny limit obejmuje wszystkie serwery. Każde pobranie dostaje stały
 * adres, a wynik poprzedniego serwera nie może wrócić do nowego ekranu. */
class PhotoCache(
    private val store: PhotoStore,
    private val currentServer: () -> String,
    private val fetch: suspend (server: String, id: Long, etag: String?) -> PhotoReply,
    private val clock: () -> Long = System::currentTimeMillis,
    private val maxBytes: Int = 32 * 1024 * 1024,
    private val maxEntries: Int = 300,
) {
    private val mutex = Mutex()
    private var entries: MutableMap<String, WpisZdjecia>? = null
    private val memory = LinkedHashMap<String, ByteArray>(32, 0.75f, true)

    private suspend fun metadata(): MutableMap<String, WpisZdjecia> = entries
        ?: store.index().toMutableMap().also { entries = it }

    private suspend fun local(key: String): ByteArray? = try {
        memory[key] ?: store.read(key)?.also { remember(key, it) }
    } catch (e: CancellationException) { throw e }
    catch (_: Exception) { null }

    private fun remember(key: String, bytes: ByteArray) {
        memory[key] = bytes
        while (memory.size > 32 || memory.values.sumOf { it.size.toLong() } > 4 * 1024 * 1024) {
            memory.remove(memory.keys.first())
        }
    }

    private suspend fun save(key: String, value: WpisZdjecia) {
        val index = metadata()
        index[key] = value
        for (old in doUsuniecia(index, maxBytes, maxEntries)) {
            store.remove(old)
            memory.remove(old)
            index.remove(old)
        }
        store.saveIndex(index.toMap())
    }

    suspend fun get(server: String, id: Long): PhotoImage? = mutex.withLock {
        if (server != currentServer()) return@withLock null
        val key = photoKey(server, id)
        fun visible(image: PhotoImage?): PhotoImage? = image.takeIf { server == currentServer() }
        try {
            val previous = metadata()[key]
            // Plik i indeks mają osobne zapisy atomowe. Po restarcie ufamy
            // parze tylko wtedy, gdy skrót potwierdza bajty związane z ETag.
            val bytes = if (previous?.brak == true) null else local(key)?.takeIf {
                previous != null && previous.sha256 == photoHash(it)
            }
            val now = clock()
            val decision = decyzja(previous, bytes != null, now)
            when (decision) {
                DecyzjaZdjecia.NieMa -> return@withLock null
                DecyzjaZdjecia.UzyjLokalnego -> {
                    save(key, previous!!.copy(uzyto = now))
                    return@withLock visible(bytes?.let { PhotoImage(it) })
                }
                else -> Unit
            }
            if (server != currentServer()) return@withLock null
            val reply = try { fetch(server, id, (decision as? DecyzjaZdjecia.Rewaliduj)?.etag) }
                catch (e: CancellationException) { throw e }
                catch (_: Exception) { return@withLock visible(bytes?.let { PhotoImage(it, stale = true) }) }
            if (server != currentServer()) return@withLock null
            when (reply.status) {
                200 -> {
                    val fresh = reply.bytes?.takeIf { it.isNotEmpty() }
                        ?: return@withLock visible(bytes?.let { PhotoImage(it, stale = true) })
                    // Metadane mogą dostać nowy ETag dopiero po udanym zapisie
                    // pliku. Inaczej odpowiedź 304 potwierdziłaby stare bajty.
                    try {
                        store.write(key, fresh)
                        remember(key, fresh)
                        save(key, WpisZdjecia(etag = reply.etag, bajtow = fresh.size, sprawdzono = now, uzyto = now, sha256 = photoHash(fresh)))
                    } catch (e: CancellationException) { throw e }
                    catch (_: Exception) { entries = null; memory.remove(key) }
                    visible(PhotoImage(fresh))
                }
                304 -> {
                    if (bytes == null || previous == null) return@withLock null
                    save(key, previous.copy(sprawdzono = now, uzyto = now))
                    visible(PhotoImage(bytes))
                }
                404 -> {
                    memory.remove(key)
                    try { store.remove(key) } catch (e: CancellationException) { throw e }
                    catch (_: Exception) { /* Odmowa usunięcia pliku nie unieważnia potwierdzonego braku zdjęcia. */ }
                    save(key, WpisZdjecia(brak = true, sprawdzono = now, uzyto = now))
                    null
                }
                401, 403 -> null
                else -> visible(bytes?.let { PhotoImage(it, stale = true) })
            }
        } catch (e: CancellationException) { throw e }
        catch (_: Exception) { null }
    }

    suspend fun forget(server: String, id: Long) = mutex.withLock {
        val key = photoKey(server, id)
        memory.remove(key)
        store.remove(key)
        metadata().remove(key)
        store.saveIndex(metadata().toMap())
    }
}
