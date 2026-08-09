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
import pl.wertis.kolektor.core.net.PutawayLineBody
import pl.wertis.kolektor.core.net.SetLocationBody
import java.io.IOException

class OfflineQueueTest {

    private class MemStorage(initial: List<PendingOp> = emptyList()) : OpStorage {
        var saved: List<PendingOp> = initial
        override fun load(): List<PendingOp> = saved
        override fun save(ops: List<PendingOp>) { saved = ops }
    }

    private val setLoc = SetLocationBody(LocAction.REPLACE, value = "E08-03-01")

    @Test fun `online sukces - nie buforuje, zwraca queueId`() = runTest {
        val storage = MemStorage()
        val q = OfflineQueue(storage, { 42L }, isOnline = { true })
        val r = q.runOrBuffer(PendingOp.OpKind.SET_LOCATION, user = "anna", productId = 7, setLocation = setLoc)
        assertFalse(r.offline)
        assertEquals(42L, r.queueId)
        assertTrue(storage.saved.isEmpty())
        assertEquals(0, q.count.value)
    }

    @Test fun `ApiError NIE jest buforowany - propaguje do UI`() = runTest {
        val storage = MemStorage()
        val q = OfflineQueue(storage, { throw ApiError(400, "Zła ilość") }, isOnline = { true })
        try {
            q.runOrBuffer(PendingOp.OpKind.SET_LOCATION, user = "anna", productId = 7, setLocation = setLoc)
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
        val r = q.runOrBuffer(PendingOp.OpKind.SET_LOCATION, user = "jan", productId = 7, setLocation = setLoc)
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
        q.runOrBuffer(PendingOp.OpKind.SET_LOCATION, user = "anna", productId = 7, setLocation = setLoc)
        // zmiana użytkownika na urządzeniu przed flushem nie zmienia autora
        online = true
        q.flush()
        assertEquals(listOf("anna"), users)
    }

    @Test fun `operacja z bufora niesie KONTO autora, nie tylko nazwe`() = runTest {
        // Jan odkłada poza zasięgiem, oddaje kolektor Piotrowi, wraca Wi-Fi.
        // Serwer rozstrzyga tożsamość z tokenu sesji — a ten przy wysyłce jest
        // już Piotra. Bez `userRef` pozycje Jana dostałyby nazwisko Piotra,
        // czyli tę samą cichą podmianę, przed którą broni jawne przejęcie.
        val storage = MemStorage()
        val q = OfflineQueue(storage, { 1L }, isOnline = { false })
        q.runOrBuffer(
            PendingOp.OpKind.SET_LOCATION,
            user = "Jan Kowalski",
            productId = 7,
            setLocation = setLoc,
            userRef = 4L,
        )
        assertEquals(1, storage.saved.size)
        assertEquals("Jan Kowalski", storage.saved[0].user)
        assertEquals(4L, storage.saved[0].userRef)
    }

    @Test fun `operacja sprzed kont przechodzi bez konta, a nie z cudzym`() = runTest {
        // bufor zapisany starszą wersją aplikacji nie ma `userRef` — wtedy
        // uczciwe jest `null`, nie doklejenie kogokolwiek
        val storage = MemStorage()
        val q = OfflineQueue(storage, { 1L }, isOnline = { false })
        q.runOrBuffer(PendingOp.OpKind.SET_LOCATION, user = "anna", productId = 7, setLocation = setLoc)
        assertEquals(null, storage.saved[0].userRef)
    }
    // ── Błąd przejściowy vs trwały ──────────────────────────────────────────
    // Do sierpnia 2026 `flush()` kasował operację przy KAŻDYM `ApiError`, więc
    // przejściowy 500 przy restarcie serwera zjadał zeskanowaną pracę
    // magazyniera. Te trzy testy pilnują rozróżnienia, bez którego log po
    // stronie serwera i tak nie miałby czego zapisać.

    @Test fun `blad 5xx ZOSTAJE w buforze i idzie ponownie`() = runTest {
        val storage = MemStorage()
        var padaj = true
        val wyslane = mutableListOf<Long?>()
        val zameldowane = mutableListOf<Int>()
        // do bufora przez brak sieci, żeby flush miał co wysyłać
        OfflineQueue(storage, { throw java.io.IOException("x") }, isOnline = { true })
            .runOrBuffer(PendingOp.OpKind.SET_LOCATION, "a", 7, setLoc)

        val q = OfflineQueue(
            storage,
            { op -> if (padaj) throw ApiError(500, "serwer padł") else { wyslane += op.productId; null } },
            isOnline = { true },
            reporter = { _, e -> zameldowane += e.status },
        )
        q.flush()
        assertEquals("500 to awaria SERWERA — operacja jest zdrowa i ma zostać", 1, q.count.value)
        assertTrue("nie meldujemy operacji, która jeszcze wróci", zameldowane.isEmpty())
        assertEquals("licznik prób ma rosnąć, inaczej pętla nigdy się nie kończy", 1, storage.saved[0].proby)

        padaj = false
        q.flush()
        assertEquals(listOf(7L), wyslane)
        assertEquals(0, q.count.value)
    }

    @Test fun `blad 4xx wypada z bufora i JEST zameldowany`() = runTest {
        val storage = MemStorage()
        val zameldowane = mutableListOf<Pair<Long?, Int>>()
        OfflineQueue(storage, { throw java.io.IOException("x") }, isOnline = { true })
            .runOrBuffer(PendingOp.OpKind.SET_LOCATION, "a", 7, setLoc)

        val q = OfflineQueue(
            storage,
            { throw ApiError(400, "Nieznana akcja") },
            isOnline = { true },
            reporter = { op, e -> zameldowane += op.productId to e.status },
        )
        q.flush()
        assertEquals(0, q.count.value)
        // sedno całej zmiany: operacja znika z kolektora, ale NIE znika bez śladu
        assertEquals(listOf(7L to 400), zameldowane)
    }

    @Test fun `po MAX_PROB przejsciowych odrzucen operacja przestaje blokowac kolejke`() = runTest {
        // inaczej serwer zwracający 500 bez końca zamraża bufor na zawsze:
        // pierwsza operacja wraca w nieskończoność, reszta nigdy nie rusza
        val storage = MemStorage()
        val zameldowane = mutableListOf<Int>()
        OfflineQueue(storage, { throw java.io.IOException("x") }, isOnline = { true })
            .runOrBuffer(PendingOp.OpKind.SET_LOCATION, "a", 7, setLoc)

        val q = OfflineQueue(
            storage,
            { throw ApiError(503, "chwilowo niedostępny") },
            isOnline = { true },
            reporter = { _, e -> zameldowane += e.status },
        )
        repeat(OfflineQueue.MAX_PROB) { q.flush() }
        assertEquals(0, q.count.value)
        assertEquals(listOf(503), zameldowane)
    }

    @Test fun `odlozenie pozycji buforuje sie przy braku sieci i wychodzi po flushu`() = runTest {
        // rozkładanie dzieje się także w martwych punktach hali — dziura Wi-Fi
        // nie może gubić policzonej pozycji
        val storage = MemStorage()
        val odlozenie = PutawayOp(
            deliveryId = 3,
            lineId = 11,
            body = PutawayLineBody("E08-03-01", recznie = true),
        )
        val q1 = OfflineQueue(storage, { throw IOException("brak sieci") }, isOnline = { true })
        val r = q1.runOrBuffer(
            PendingOp.OpKind.PUTAWAY, user = "anna", productId = 7, putaway = odlozenie,
        )
        assertTrue(r.offline)
        assertEquals(1, q1.count.value)
        // operacja przeżywa restart aplikacji z KOMPLETEM danych do wysłania
        assertEquals(odlozenie, storage.saved.single().putaway)

        val wyslane = mutableListOf<PendingOp>()
        val q2 = OfflineQueue(storage, { wyslane += it; null }, isOnline = { true })
        q2.flush()
        assertEquals(0, q2.count.value)
        assertEquals(PendingOp.OpKind.PUTAWAY, wyslane.single().kind)
        assertEquals("anna", wyslane.single().user)
    }

    @Test fun `meldunek ktory sam padnie nie wywraca oproznienia kolejki`() = runTest {
        val storage = MemStorage()
        OfflineQueue(storage, { throw java.io.IOException("x") }, isOnline = { true })
            .runOrBuffer(PendingOp.OpKind.SET_LOCATION, "a", 7, setLoc)

        val q = OfflineQueue(
            storage,
            { throw ApiError(400, "zła akcja") },
            isOnline = { true },
            reporter = { _, _ -> throw IllegalStateException("brak sieci na meldunek") },
        )
        q.flush() // nie może rzucić
        assertEquals(0, q.count.value)
    }
}
