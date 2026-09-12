package pl.wertis.kolektor.core.wms

import java.io.IOException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.*
import org.junit.Test
import pl.wertis.kolektor.core.net.ApiError
import pl.wertis.kolektor.core.net.WertisJson
import pl.wertis.kolektor.core.scan.classify

private val putawayActor = WmsContext("http://seeded/", 2)
private val part = WmsPutawayTask(1, 30, "BUF-01", 12, 12, 2, 1, "WMS0030", "Koło", "0590123", "PZ-1")
private fun draft() = putawayScan(part, 2, WmsPutawayScan(true, part.barcode, 3), "A-01").command!!

class WmsPutawayScanTest {
    @Test fun `podpowiedz czyta pojemnosc i starsze API nie obiecuje miejsca`() {
        val old = WertisJson.decodeFromString<WmsPutawayBin>("""{"bin":"A-01","on_hand":8,"mode":"pick"}""")
        assertNull(old.room)
        assertTrue(old.hint.contains("sprawdź miejsce"))
        val current = WertisJson.decodeFromString<WmsPutawayBin>("""{"tw_id":30,"bin":"A-01","on_hand":8,"mode":"pick","room":2}""")
        assertEquals(2, current.room)
        assertTrue(current.hint.contains("do 2 szt."))
        // Podpowiedź może się zdezaktualizować; dopiero serwer zatwierdza faktyczny skan.
        val task = part.copy(bins = listOf(current))
        assertNotNull(putawayScan(task, 2, WmsPutawayScan(true, part.barcode, 3), "A-01").command)
    }
    @Test fun `bufor czesc policzona ilosc i polka dopiero tworza zapis`() {
        var scan = WmsPutawayScan()
        assertNotNull(putawayScan(part, 2, scan, "A-01").error)
        scan = putawayScan(part, 2, scan, "BUF-01").state
        assertNotNull(putawayScan(part, 2, scan, "ZLA-CZESC").error)
        scan = putawayScan(part, 2, scan, part.barcode!!).state
        assertNotNull(putawayScan(part, 2, scan, "A-01").error)
        scan = putawayQuantity(part, scan, "3").state
        val command = putawayScan(part, 2, scan, "A-01").command!!
        assertEquals("3", command.body["quantity"]!!.jsonPrimitive.content)
        assertEquals("1", command.body["version"]!!.jsonPrimitive.content)
        assertEquals("BUF-01", command.body["source"]!!.jsonPrimitive.content)
        assertEquals(12, part.remaining)
    }
    @Test fun `prefiks lokalizacji nie obcina kodu czesci`() {
        assertEquals("LOC:WMS0030", putawayCode(WmsPutawayStage.PRODUCT, classify("LOC:WMS0030")))
        assertEquals("BUF-01", putawayCode(WmsPutawayStage.SOURCE, classify("LOC:BUF-01")))
        assertEquals("A-01", putawayCode(WmsPutawayStage.TARGET, classify("LOC:A-01")))
        assertNotNull(putawayScan(part, 2, WmsPutawayScan(true), "590123").error)
    }
    @Test fun `ilosc nie przyjmuje zera nadmiaru ulamka ani przekroczenia int`() {
        for (raw in listOf("0", "-1", "13", "1.5", "999999999999999", "")) {
            assertNotNull(putawayQuantity(part, WmsPutawayScan(true, part.barcode), raw).error)
        }
        assertNotNull(putawayQuantity(part, WmsPutawayScan(), "3").error)
    }
    @Test fun `obcy wlasciciel zamkniete zadanie i ten sam cel nie tworza ruchu`() {
        val scan = WmsPutawayScan(true, part.barcode, 3)
        for (task in listOf(part.copy(user_id = 4), part.copy(remaining = 0), part.copy(user_id = null))) {
            assertNull(putawayScan(task, 2, scan, "A-01").command)
        }
        assertNull(putawayScan(part, 2, scan, "BUF-01").command)
        assertNull(putawayScan(part, 2, scan, "A/01").command)
        assertThrows(IllegalArgumentException::class.java) { putawayClaim(part) }
    }
    @Test fun `uszkodzenie jest jawna dyspozycja a kwarantanne sprawdza serwer`() {
        val command = putawayScan(part, 2, WmsPutawayScan(true, part.barcode, 2), "QUAR-01", damaged = true).command!!
        assertEquals("damaged", command.body["disposition"]!!.jsonPrimitive.content)
        assertTrue(command.body["reason"]!!.jsonPrimitive.content.isNotBlank())
        assertFalse(draft().body.containsKey("disposition"))
    }
    @Test fun `dawny dziennik zbiórki zachowuje domyslny proces`() {
        val old = """{"pending":{"key":"old","context":{"server":"http://seeded/","actorId":2},"path":"api/wms/cart-start","body":{},"description":"Start"}}"""
        val journal = WertisJson.decodeFromString<WmsJournal>(old)
        assertEquals("picking", journal.pending!!.workflow)
        assertNull(journal.putaway)
        val extended = journal.copy(putaway = WmsActivePutaway(putawayActor, 1))
        assertEquals(extended, WertisJson.decodeFromString<WmsJournal>(WertisJson.encodeToString(WmsJournal.serializer(), extended)))
    }
}

private class PutawayStore : WmsStore {
    var journal = WmsJournal(active = WmsActive(putawayActor, 5))
    var failWrite: (WmsJournal) -> Boolean = { false }
    override suspend fun read() = journal
    override suspend fun write(journal: WmsJournal) {
        if (failWrite(journal)) throw IOException("Dysk")
        this.journal = journal
    }
}
private class PutawayClient(private val store: PutawayStore) : WmsPutawayTransport {
    var current = part
    var failure: Exception? = null
    var lostResponse = false
    var getFailure = false
    var before: suspend () -> Unit = {}
    val sent = mutableListOf<WmsPending>()
    val committed = mutableSetOf<String>()
    var queried: Pair<String, Int>? = null
    override suspend fun queue(query: String, offset: Int): WmsPutawayQueue {
        queried = query to offset
        return WmsPutawayQueue(listOf(current), WmsPutawayTotals(1, current.remaining))
    }
    override suspend fun putawayTask(id: Long): WmsPutawayTask {
        if (getFailure) throw IOException("Odczyt")
        return current
    }
    override suspend fun send(command: WmsPending) {
        assertEquals(command, store.journal.pending)
        sent += command
        before()
        failure?.let { throw it }
        if (committed.add(command.key)) current = if (command.path.endsWith("/claim")) current.copy(user_id = 2, version = current.version + 1)
            else current.copy(remaining = current.remaining - command.body["quantity"]!!.jsonPrimitive.int, version = current.version + 1)
        if (lostResponse) throw IOException("Utracona odpowiedź")
    }
}

class WmsPutawayRecoveryTest {
    @Test fun `podjecie potwierdza wlasciciela i zachowuje aktywny wozek`() = runTest {
        val store = PutawayStore(); val client = PutawayClient(store)
        client.current = part.copy(user_id = null)
        val controller = WmsPutawayController(store, { client })
        controller.select(putawayActor, 1)
        assertTrue(client.sent.isEmpty())
        controller.submit(putawayActor, putawayClaim(client.current))
        assertEquals(2L, controller.state.value.task!!.user_id)
        assertEquals(WmsActive(putawayActor, 5), store.journal.active)
        assertNull(store.journal.pending)
    }
    @Test fun `utrata odpowiedzi i restart ponawiaja ten sam klucz bez drugiego ruchu`() = runTest {
        val store = PutawayStore(); val client = PutawayClient(store)
        val first = WmsPutawayController(store, { client })
        first.select(putawayActor, 1); client.lostResponse = true; first.submit(putawayActor, draft())
        val pending = store.journal.pending!!
        assertEquals("putaway", pending.workflow)
        assertEquals(9, client.current.remaining)
        val restarted = WmsPutawayController(store, { client })
        restarted.open(putawayActor)
        assertFalse(restarted.state.value.ready)
        client.lostResponse = false; restarted.retry(putawayActor)
        assertEquals(pending, client.sent.last())
        assertEquals(1, client.committed.size)
        assertEquals(9, restarted.state.value.task!!.remaining)
        assertNull(store.journal.pending)
    }
    @Test fun `odmowa dysku przed wyslaniem zatrzymuje ruch`() = runTest {
        val store = PutawayStore(); val client = PutawayClient(store)
        val controller = WmsPutawayController(store, { client })
        controller.select(putawayActor, 1)
        store.failWrite = { it.pending != null }
        controller.submit(putawayActor, draft())
        assertTrue(client.sent.isEmpty())
        assertFalse(controller.state.value.ready)
    }
    @Test fun `odmowa kasowania dziennika po sukcesie zostawia klucz do odzyskania`() = runTest {
        val store = PutawayStore(); val client = PutawayClient(store)
        val controller = WmsPutawayController(store, { client })
        controller.select(putawayActor, 1)
        store.failWrite = { it.pending == null }
        controller.submit(putawayActor, draft())
        assertNotNull(store.journal.pending)
        assertEquals(9, client.current.remaining)
        store.failWrite = { false }; controller.retry(putawayActor)
        assertEquals(1, client.committed.size)
        assertNull(store.journal.pending)
    }
    @Test fun `inny serwer lub osoba nie ponawiaja zapisu`() = runTest {
        val store = PutawayStore(); val client = PutawayClient(store)
        val controller = WmsPutawayController(store, { client })
        controller.select(putawayActor, 1); client.lostResponse = true; controller.submit(putawayActor, draft())
        for (foreign in listOf(putawayActor.copy(actorId = 3), putawayActor.copy(server = "http://other/"))) {
            controller.open(foreign); controller.retry(foreign); controller.queue(foreign)
            assertFalse(controller.state.value.ready)
            assertNotNull(store.journal.pending)
        }
        assertEquals(1, client.sent.size)
    }
    @Test fun `zwykle 403 i infrastruktura zachowuja zapis a potwierdzona odmowa go rozlicza`() = runTest {
        for (failure in listOf(ApiError(403, "Sesja"), ApiError(500, "Serwer"), ApiError(429, "Limit"))) {
            val store = PutawayStore(); val client = PutawayClient(store)
            val controller = WmsPutawayController(store, { client })
            controller.select(putawayActor, 1); client.failure = failure; controller.submit(putawayActor, draft())
            assertNotNull(store.journal.pending)
            client.failure = ApiError(403, "Przejęte", "WMS_COMMAND_REJECTED")
            client.current = part.copy(user_id = 3)
            controller.retry(putawayActor)
            assertNull(store.journal.pending)
            assertEquals(WmsPutawayStage.OTHER, putawayStage(controller.state.value.task!!, 2, WmsPutawayScan()))
        }
    }
    @Test fun `blad odczytu po potwierdzeniu blokuje kolejne skany az do odswiezenia`() = runTest {
        val store = PutawayStore(); val client = PutawayClient(store)
        val controller = WmsPutawayController(store, { client })
        controller.select(putawayActor, 1); client.getFailure = true; controller.submit(putawayActor, draft())
        assertNull(store.journal.pending)
        assertFalse(controller.state.value.ready)
        controller.submit(putawayActor, draft())
        assertEquals(1, client.sent.size)
        client.getFailure = false; controller.open(putawayActor)
        assertEquals(9, controller.state.value.task!!.remaining)
    }
    @Test fun `powrot z tla i czesciowy ruch uniewazniaja skany`() = runTest {
        val store = PutawayStore(); val client = PutawayClient(store)
        val controller = WmsPutawayController(store, { client })
        controller.select(putawayActor, 1)
        val first = controller.state.value.generation
        controller.invalidateVerification()
        assertFalse(controller.state.value.ready)
        controller.submit(putawayActor, draft()); assertTrue(client.sent.isEmpty())
        controller.activateVerification(); controller.open(putawayActor); controller.submit(putawayActor, draft())
        assertTrue(controller.state.value.generation > first)
        assertEquals(WmsPutawayStage.SOURCE, putawayStage(controller.state.value.task!!, 2, WmsPutawayScan()))
    }
    @Test fun `szybki drugi skan nie czeka na blokadzie i nie wysyla kolejnego ruchu`() = runTest {
        val store = PutawayStore(); val client = PutawayClient(store)
        val controller = WmsPutawayController(store, { client })
        controller.select(putawayActor, 1)
        val entered = CompletableDeferred<Unit>(); val release = CompletableDeferred<Unit>()
        client.before = { entered.complete(Unit); release.await() }
        val sending = launch { controller.submit(putawayActor, draft()) }
        entered.await(); controller.submit(putawayActor, draft()); release.complete(Unit); sending.join()
        assertEquals(1, client.sent.size)
    }
    @Test fun `anulowanie korutyny pozostawia trwaly zapis`() = runTest {
        val store = PutawayStore(); val client = PutawayClient(store)
        val controller = WmsPutawayController(store, { client })
        controller.select(putawayActor, 1); client.failure = CancellationException()
        try { controller.submit(putawayActor, draft()); fail("Anulowanie musi wyjść") } catch (_: CancellationException) { }
        assertNotNull(store.journal.pending)
        assertFalse(controller.state.value.busy)
    }
    @Test fun `kolejka przekazuje filtr i strone bez zapisu na serwerze`() = runTest {
        val store = PutawayStore(); val client = PutawayClient(store)
        val controller = WmsPutawayController(store, { client })
        controller.queue(putawayActor, "0590123", 50)
        assertEquals("0590123" to 50, client.queried)
        assertTrue(client.sent.isEmpty())
        assertEquals(WmsActive(putawayActor, 5), store.journal.active)
    }
    @Test fun `blad odpowiedzi innego zadania nie odblokowuje ekranu`() = runTest {
        val store = PutawayStore(); val client = PutawayClient(store)
        client.current = part.copy(id = 999)
        val controller = WmsPutawayController(store, { client })
        controller.select(putawayActor, 1)
        assertFalse(controller.state.value.ready)
        assertNull(store.journal.putaway)
    }
}

class WmsCrossWorkflowTest {
    private val cart = WmsRun(5, "CART-20", 2, orders = emptyList(), tasks = emptyList())
    private fun cartDraft() = wmsScan(null, 2, WmsScanState(), "CART-20").command!!
    @Test fun `zakonczenie wozka nie usuwa wznowienia odkladania`() = runTest {
        val store = PutawayStore()
        store.journal = store.journal.copy(putaway = WmsActivePutaway(putawayActor, 1))
        val picking = WmsController(store, { object : WmsTransport {
            override suspend fun run(id: Long) = cart.copy(arrived_at = "2026-09-12")
            override suspend fun send(command: WmsPending): Long? = 5
        } })
        picking.open(putawayActor); picking.nextCart(putawayActor)
        assertNull(store.journal.active)
        assertEquals(WmsActivePutaway(putawayActor, 1), store.journal.putaway)
        picking.submit(putawayActor, cartDraft())
        assertEquals(WmsActivePutaway(putawayActor, 1), store.journal.putaway)
    }
    @Test fun `nieznane odkladanie blokuje rowniez juz otwarta zbiorke`() = runTest {
        val store = PutawayStore(); val client = PutawayClient(store); val mutex = Mutex()
        var cartWrites = 0
        val picking = WmsController(store, { object : WmsTransport {
            override suspend fun run(id: Long) = cart
            override suspend fun send(command: WmsPending): Long? { cartWrites++; return 5 }
        } }, lock = mutex)
        val putaway = WmsPutawayController(store, { client }, lock = mutex)
        picking.open(putawayActor); putaway.select(putawayActor, 1)
        client.lostResponse = true; putaway.submit(putawayActor, draft())
        val pending = store.journal.pending
        picking.submit(putawayActor, cartDraft()); picking.retry(putawayActor)
        assertEquals(0, cartWrites)
        assertEquals(pending, store.journal.pending)
        assertFalse(picking.state.value.ready)
    }
    @Test fun `nieznana zbiorka blokuje odkladanie i nie jest ponawiana jego klientem`() = runTest {
        val store = PutawayStore(); val client = PutawayClient(store); val mutex = Mutex()
        val picking = WmsController(store, { object : WmsTransport {
            override suspend fun run(id: Long) = cart
            override suspend fun send(command: WmsPending): Long? = throw IOException()
        } }, lock = mutex)
        val putaway = WmsPutawayController(store, { client }, lock = mutex)
        putaway.select(putawayActor, 1); picking.open(putawayActor); picking.submit(putawayActor, cartDraft())
        val pending = store.journal.pending
        putaway.submit(putawayActor, draft()); putaway.retry(putawayActor); putaway.queue(putawayActor)
        assertEquals(pending, store.journal.pending)
        assertTrue(client.sent.isEmpty())
    }
    @Test fun `wspolna blokada zabrania zbiorce wyprzedzic trwajace odkladanie`() = runTest {
        val store = PutawayStore(); val client = PutawayClient(store); val mutex = Mutex()
        var cartWrites = 0
        val picking = WmsController(store, { object : WmsTransport {
            override suspend fun run(id: Long) = cart
            override suspend fun send(command: WmsPending): Long? { cartWrites++; return 5 }
        } }, lock = mutex)
        val putaway = WmsPutawayController(store, { client }, lock = mutex)
        picking.open(putawayActor); putaway.select(putawayActor, 1)
        val entered = CompletableDeferred<Unit>(); val release = CompletableDeferred<Unit>()
        client.before = { entered.complete(Unit); release.await() }
        val sending = launch { putaway.submit(putawayActor, draft()) }
        entered.await(); picking.submit(putawayActor, cartDraft()); release.complete(Unit); sending.join()
        assertEquals(0, cartWrites)
        assertEquals(1, client.committed.size)
        assertEquals(WmsActive(putawayActor, 5), store.journal.active)
    }
}
