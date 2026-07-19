package pl.wertis.kolektor.core.offline

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import pl.wertis.kolektor.core.net.ApiError
import pl.wertis.kolektor.core.net.LocAction
import pl.wertis.kolektor.core.net.MmBody
import pl.wertis.kolektor.core.net.MmItem
import pl.wertis.kolektor.core.net.SetLocationBody
import java.io.IOException

class OfflineQueueTest {

    private class MemStorage(initial: List<PendingOp> = emptyList()) : OpStorage {
        var saved: List<PendingOp> = initial
        override fun load(): List<PendingOp> = saved
        override fun save(ops: List<PendingOp>) { saved = ops }
    }

    private val setLoc = SetLocationBody(LocAction.REPLACE, value = "E08-03-01")
    private val mmBody = MmBody(listOf(MmItem(7, 2.0)))

    @Test fun `online sukces - nie buforuje, zwraca queueId`() = runTest {
        val storage = MemStorage()
        val q = OfflineQueue(storage, { 42L }, isOnline = { true })
        val r = q.runOrBuffer(PendingOp.OpKind.SET_LOCATION, user = "anna", productId = 7, setLocation = setLoc)
        assertFalse(r.offline)
        assertEquals(42L, r.queueId)
        assertNull(r.bufferId)
        assertTrue(storage.saved.isEmpty())
        assertEquals(0, q.count.value)
    }

    @Test fun `ApiError NIE jest buforowany - propaguje do UI`() = runTest {
        val storage = MemStorage()
        val q = OfflineQueue(storage, { throw ApiError(400, "Zła ilość") }, isOnline = { true })
        try {
            q.runOrBuffer(PendingOp.OpKind.MM, user = "anna", mm = mmBody)
            fail("oczekiwano ApiError")
        } catch (e: ApiError) {
            assertEquals(400, e.status)
        }
        assertTrue(storage.saved.isEmpty())
    }

    @Test fun `blad sieci przy online - buforuje`() = runTest {
        val storage = MemStorage()
        val q = OfflineQueue(storage, { throw IOException("timeout") }, isOnline = { true })
        val r = q.runOrBuffer(PendingOp.OpKind.SET_LOCATION, user = "anna", productId = 7, setLocation = setLoc)
        assertTrue(r.offline)
        assertEquals(1, storage.saved.size)
        assertEquals("anna", storage.saved[0].user)
        assertEquals(1, q.count.value)
    }

    @Test fun `offline - buforuje bez proby wysylki`() = runTest {
        var sends = 0
        val q = OfflineQueue(MemStorage(), { sends++; null }, isOnline = { false })
        val r = q.runOrBuffer(PendingOp.OpKind.MM, user = "jan", mm = mmBody)
        assertTrue(r.offline)
        assertEquals(0, sends)
    }

    @Test fun `flush FIFO - stop na bledzie sieci`() = runTest {
        val storage = MemStorage()
        var online = false
        val sent = mutableListOf<String>()
        var failFrom = 2
        val q = OfflineQueue(
            storage,
            { op ->
                if (sent.size >= failFrom) throw IOException("net")
                sent += op.id; null
            },
            isOnline = { online },
        )
        q.runOrBuffer(PendingOp.OpKind.SET_LOCATION, "a", 1, setLoc)
        q.runOrBuffer(PendingOp.OpKind.SET_LOCATION, "a", 2, setLoc)
        q.runOrBuffer(PendingOp.OpKind.SET_LOCATION, "a", 3, setLoc)
        assertEquals(3, q.count.value)

        online = true
        q.flush()
        assertEquals(2, sent.size)          // dwie poszły, trzecia utknęła na "sieci"
        assertEquals(1, q.count.value)      // reszta czeka

        failFrom = Int.MAX_VALUE
        q.flush()
        assertEquals(3, sent.size)
        assertEquals(0, q.count.value)
    }

    @Test fun `flush - odrzucenie serwera usuwa operacje i idzie dalej`() = runTest {
        val storage = MemStorage()
        var online = false
        val rejected = mutableListOf<String>()
        val sentProducts = mutableListOf<Long?>()
        val q = OfflineQueue(
            storage,
            { op ->
                if (op.productId == 2L) throw ApiError(409, "konflikt")
                sentProducts += op.productId; null
            },
            isOnline = { online },
            onRejected = { _, msg -> rejected += msg },
        )
        q.runOrBuffer(PendingOp.OpKind.SET_LOCATION, "a", 1, setLoc)
        q.runOrBuffer(PendingOp.OpKind.SET_LOCATION, "a", 2, setLoc)
        q.runOrBuffer(PendingOp.OpKind.SET_LOCATION, "a", 3, setLoc)

        online = true
        q.flush()
        assertEquals(listOf(1L, 3L), sentProducts) // odrzucona 2 nie blokuje
        assertEquals(listOf("konflikt"), rejected)
        assertEquals(0, q.count.value)
    }

    @Test fun `remove - COFNIJ przed wysylka`() = runTest {
        val q = OfflineQueue(MemStorage(), { null }, isOnline = { false })
        val r = q.runOrBuffer(PendingOp.OpKind.MM, "a", mm = mmBody)
        assertTrue(q.remove(r.bufferId!!))
        assertFalse(q.remove(r.bufferId!!))
        assertEquals(0, q.count.value)
    }

    @Test fun `bufor przezywa restart (storage)`() = runTest {
        val storage = MemStorage()
        val q1 = OfflineQueue(storage, { null }, isOnline = { false })
        q1.runOrBuffer(PendingOp.OpKind.SET_LOCATION, "a", 1, setLoc)

        val q2 = OfflineQueue(storage, { null }, isOnline = { false })
        assertEquals(1, q2.count.value)
    }

    @Test fun `flush zachowuje autora operacji`() = runTest {
        val storage = MemStorage()
        var online = false
        val users = mutableListOf<String>()
        val q = OfflineQueue(storage, { op -> users += op.user; null }, isOnline = { online })
        q.runOrBuffer(PendingOp.OpKind.MM, user = "anna", mm = mmBody)
        // zmiana użytkownika na urządzeniu przed flushem nie zmienia autora
        online = true
        q.flush()
        assertEquals(listOf("anna"), users)
    }
}
