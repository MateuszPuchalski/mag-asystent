package pl.wertis.kolektor.core.product

import java.io.IOException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test

private class Photos : PhotoStore {
    var entries = emptyMap<String, WpisZdjecia>()
    val files = mutableMapOf<String, ByteArray>()
    var failWrite = false
    var failIndex = false
    override suspend fun index() = entries
    override suspend fun saveIndex(index: Map<String, WpisZdjecia>) {
        if (failIndex) throw IOException()
        entries = index.toMap()
    }
    override suspend fun read(key: String) = files[key]
    override suspend fun write(key: String, bytes: ByteArray) {
        if (failWrite) throw IOException()
        files[key] = bytes
    }
    override suspend fun remove(key: String) { files.remove(key) }
}

class PhotoCacheTest {
    @Test fun `restart po przerwanym zapisie indeksu nie potwierdza nowych bajtow starym ETag`() = runTest {
        val store = Photos(); var now = 1000L
        var body = byteArrayOf(1)
        val cache = PhotoCache(store, { "A" }, { _, _, _ -> PhotoReply(200, body, "v${body[0]}") }, clock = { now })
        cache.get("A", 1)
        now += SWIEZOSC_MS; body = byteArrayOf(2); store.failIndex = true
        assertArrayEquals(body, cache.get("A", 1)!!.bytes)
        assertEquals("v1", store.entries[photoKey("A", 1)]!!.etag)
        store.failIndex = false
        val restarted = PhotoCache(store, { "A" }, { _, _, etag ->
            assertNull("Niezgodny plik wymaga pełnego pobrania, nawet po powrocie serwera do starej wersji", etag)
            PhotoReply(200, byteArrayOf(1), "v1")
        }, clock = { now })
        assertArrayEquals(byteArrayOf(1), restarted.get("A", 1)!!.bytes)
    }

    @Test fun `gorace zdjecie w RAM podlega rewalidacji a miniatura zmienia klucz`() = runTest {
        val store = Photos()
        var now = 1000L
        var calls = 0
        val old = byteArrayOf(1); val fresh = byteArrayOf(2)
        val cache = PhotoCache(store, { "A" }, { server, _, etag ->
            assertEquals("A", server)
            calls++
            if (calls == 1) PhotoReply(200, old, "v1") else {
                assertEquals("v1", etag); PhotoReply(200, fresh, "v2")
            }
        }, clock = { now })
        assertArrayEquals(old, cache.get("A", 1)!!.bytes)
        assertArrayEquals(old, cache.get("A", 1)!!.bytes)
        assertEquals(1, calls)
        now += SWIEZOSC_MS
        assertArrayEquals(fresh, cache.get("A", 1)!!.bytes)
        assertEquals(2, calls)
        assertNotEquals(photoBitmapKey(1, 372, old), photoBitmapKey(1, 372, fresh))
    }

    @Test fun `ten sam numer kartoteki na dwoch serwerach nie dzieli zdjecia takze po restarcie`() = runTest {
        val store = Photos()
        var server = "A"
        val cache = PhotoCache(store, { server }, { host, _, _ -> PhotoReply(200, host.toByteArray(), host) })
        assertArrayEquals("A".toByteArray(), cache.get("A", 7)!!.bytes)
        server = "B"
        assertArrayEquals("B".toByteArray(), cache.get("B", 7)!!.bytes)
        val restarted = PhotoCache(store, { server }, { _, _, _ -> error("Świeży plik nie wymaga sieci") })
        assertArrayEquals("B".toByteArray(), restarted.get("B", 7)!!.bytes)
        assertNotEquals(photoKey("A", 7), photoKey("B", 7))
    }

    @Test fun `odpowiedz poprzedniego serwera po zmianie adresu nie wraca do ekranu`() = runTest {
        val store = Photos()
        var server = "A"
        val entered = CompletableDeferred<Unit>(); val release = CompletableDeferred<Unit>()
        val cache = PhotoCache(store, { server }, { host, _, _ ->
            assertEquals("A", host); entered.complete(Unit); release.await(); PhotoReply(200, byteArrayOf(1))
        })
        val request = async { cache.get("A", 7) }
        entered.await(); server = "B"; release.complete(Unit)
        assertNull(request.await())
        assertTrue(store.files.isEmpty())
    }

    @Test fun `304 odswieza metadane bez ponownego pobierania bajtow`() = runTest {
        val store = Photos(); var now = 1000L; var calls = 0
        val cache = PhotoCache(store, { "A" }, { _, _, etag ->
            calls++
            if (etag == null) PhotoReply(200, byteArrayOf(1), "v1") else PhotoReply(304)
        }, clock = { now })
        cache.get("A", 1); now += SWIEZOSC_MS
        assertFalse(cache.get("A", 1)!!.stale)
        cache.get("A", 1)
        assertEquals(2, calls)
        assertEquals(now, store.entries[photoKey("A", 1)]!!.sprawdzono)
    }

    @Test fun `404 usuwa stary obraz z pamieci i dysku`() = runTest {
        val store = Photos(); var now = 1000L; var removed = false
        val cache = PhotoCache(store, { "A" }, { _, _, _ -> if (removed) PhotoReply(404) else PhotoReply(200, byteArrayOf(1), "v1") }, clock = { now })
        cache.get("A", 1); now += SWIEZOSC_MS; removed = true
        assertNull(cache.get("A", 1)); assertNull(cache.get("A", 1))
        assertTrue(store.files.isEmpty())
        assertTrue(store.entries[photoKey("A", 1)]!!.brak)
    }

    @Test fun `awaria sieci i 503 pokazuja oznaczona kopie bez zapisywania falszywego braku`() = runTest {
        val store = Photos(); var now = 1000L; var status = 200
        val cache = PhotoCache(store, { "A" }, { _, _, _ ->
            if (status == 0) throw IOException()
            PhotoReply(status, if (status == 200) byteArrayOf(1) else null, "v1")
        }, clock = { now })
        cache.get("A", 1); now += SWIEZOSC_MS
        for (code in listOf(0, 503)) {
            status = code
            assertTrue(cache.get("A", 1)!!.stale)
            assertFalse(store.entries[photoKey("A", 1)]!!.brak)
        }
    }

    @Test fun `anulowanie nie jest sukcesem z kopii offline`() = runTest {
        val store = Photos(); var now = 1000L; var cancel = false
        val cache = PhotoCache(store, { "A" }, { _, _, _ ->
            if (cancel) throw CancellationException()
            PhotoReply(200, byteArrayOf(1), "v1")
        }, clock = { now })
        cache.get("A", 1); now += SWIEZOSC_MS; cancel = true
        try { cache.get("A", 1); fail("Anulowanie musi przejść do właściciela ekranu") }
        catch (_: CancellationException) { }
    }

    @Test fun `odmowa dysku nie przypisuje nowego ETag do starych bajtow`() = runTest {
        val store = Photos(); var now = 1000L
        val cache = PhotoCache(store, { "A" }, { _, _, tag -> PhotoReply(200, byteArrayOf(if (tag == null) 1 else 2), if (tag == null) "v1" else "v2") }, clock = { now })
        cache.get("A", 1); now += SWIEZOSC_MS; store.failWrite = true
        assertArrayEquals(byteArrayOf(2), cache.get("A", 1)!!.bytes)
        assertEquals("v1", store.entries[photoKey("A", 1)]!!.etag)
        assertArrayEquals(byteArrayOf(1), store.files[photoKey("A", 1)])
    }

    @Test fun `braki zdjec tez podlegaja limitowi wpisow`() = runTest {
        val store = Photos(); var now = 1000L
        val cache = PhotoCache(store, { "A" }, { _, _, _ -> PhotoReply(404) }, clock = { now++ }, maxEntries = 2)
        for (id in 1L..10L) cache.get("A", id)
        assertEquals(2, store.entries.size)
        assertTrue(store.entries.containsKey(photoKey("A", 10)))
    }

    @Test fun `utrata pliku wymaga calego obrazu zamiast warunkowego 304`() = runTest {
        val store = Photos()
        val first = PhotoCache(store, { "A" }, { _, _, _ -> PhotoReply(200, byteArrayOf(1), "v1") })
        first.get("A", 1); store.files.clear()
        val restarted = PhotoCache(store, { "A" }, { _, _, etag ->
            assertNull(etag); PhotoReply(200, byteArrayOf(2), "v2")
        })
        assertArrayEquals(byteArrayOf(2), restarted.get("A", 1)!!.bytes)
    }

    @Test fun `odmowa dostepu nie jest brakiem zdjecia ani zgoda na stara kopie`() = runTest {
        val store = Photos(); var now = 1000L; var status = 200
        val cache = PhotoCache(store, { "A" }, { _, _, _ -> PhotoReply(status, byteArrayOf(1), "v1") }, clock = { now })
        cache.get("A", 1); now += SWIEZOSC_MS
        for (code in listOf(401, 403)) {
            status = code; assertNull(cache.get("A", 1))
            assertFalse(store.entries[photoKey("A", 1)]!!.brak)
        }
    }

    @Test fun `cofniecie zegara wymaga sprawdzenia obu rodzajow wpisow`() {
        assertEquals(DecyzjaZdjecia.Rewaliduj("v1"), decyzja(WpisZdjecia(etag = "v1", sprawdzono = 2000), true, 1000))
        assertEquals(DecyzjaZdjecia.Pobierz, decyzja(WpisZdjecia(brak = true, sprawdzono = 2000), false, 1000))
    }

    @Test fun `przed przekroczeniem limitu nie usuwa zdjec tylko aby osiagnac 80 procent`() {
        assertTrue(doUsuniecia(mapOf("a" to WpisZdjecia(bajtow = 900)), 1000, 300).isEmpty())
    }
}
