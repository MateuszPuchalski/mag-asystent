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

private val receiver = WmsContext("http://seeded/", 2)
private val receivedPart = WmsInboundLine(7, 1, 30, "WMS-0030", "Koło", "0590123", 12, 0, 0, 1)
private val receiptDocument = WmsInboundDocument(WmsInboundHeader(1, "PZ-1", "Seeded", 1),
    WmsInboundSummary(1, 12, 0, 0, 12), listOf(receivedPart), 1, receivedPart)
private fun receiveDraft(buffer: Boolean = true, damaged: Boolean = false) =
    inboundReceive(receiptDocument, WmsInboundScan(receivedPart.barcode, 3), if (damaged) "QUAR-01" else "BUF-01", buffer, damaged)

class WmsInboundScanTest {
    @Test fun `czesc policzona ilosc i kod bufora tworza jedna partie`() {
        val scan = inboundProduct(receivedPart, "0590123")
        assertEquals(WmsInboundStage.QUANTITY, inboundStage(receiptDocument, scan))
        val counted = inboundQuantity(receivedPart, scan, "3")
        val draft = inboundReceive(receiptDocument, counted, "BUF-01", true, false)
        assertEquals("3", draft.body["quantity"]!!.jsonPrimitive.content)
        assertEquals("true", draft.body["staged"]!!.jsonPrimitive.content)
        assertEquals("7", draft.body["lineId"]!!.jsonPrimitive.content)
        assertEquals("1", draft.body["version"]!!.jsonPrimitive.content)
        assertEquals(0, receivedPart.received)
    }
    @Test fun `przyjecie na polke i uszkodzenie nie tworza pracy z bufora`() {
        assertFalse(receiveDraft(buffer = false).body.containsKey("staged"))
        val damaged = receiveDraft(damaged = true)
        assertFalse(damaged.body.containsKey("staged"))
        assertEquals("damaged", damaged.body["disposition"]!!.jsonPrimitive.content)
        assertTrue(damaged.body["reason"]!!.jsonPrimitive.content.isNotBlank())
    }
    @Test fun `kody zachowuja wiodace zero a prefiks dotyczy tylko lokalizacji`() {
        assertThrows(IllegalArgumentException::class.java) { inboundProduct(receivedPart, "590123") }
        assertThrows(IllegalArgumentException::class.java) { inboundProduct(receivedPart, "LOC:WMS-0030") }
        assertEquals("WMS-0030", inboundProduct(receivedPart, "WMS-0030").barcode)
        assertEquals("BUF-01", inboundDestinationCode(classify("LOC:BUF-01")))
    }
    @Test fun `nadmiar zero ulamek brak skanu i obca pozycja nie tworza przyjecia`() {
        for (raw in listOf("0", "-1", "13", "1.5", "99999999999", "")) {
            assertThrows(IllegalArgumentException::class.java) { inboundQuantity(receivedPart, WmsInboundScan(receivedPart.barcode), raw) }
        }
        assertThrows(IllegalArgumentException::class.java) { inboundQuantity(receivedPart, WmsInboundScan(), "3") }
        assertThrows(IllegalArgumentException::class.java) { inboundReceive(receiptDocument.copy(selected = receivedPart.copy(inbound_id = 99)), WmsInboundScan(receivedPart.barcode, 3), "BUF-01", true, false) }
    }
    @Test fun `policzona lub zamknieta dostawa nie przyjmuje kolejnego skanu celu`() {
        val full = receiptDocument.copy(selected = receivedPart.copy(received = 12))
        assertEquals(WmsInboundStage.COMPLETE, inboundStage(full, WmsInboundScan(receivedPart.barcode)))
        assertThrows(IllegalArgumentException::class.java) { inboundReceive(full, WmsInboundScan(receivedPart.barcode, 3), "BUF-01", true, false) }
        val closed = receiptDocument.copy(document = receiptDocument.document.copy(closed_at = "2026-09-12"))
        assertThrows(IllegalArgumentException::class.java) { inboundReceive(closed, WmsInboundScan(receivedPart.barcode, 3), "BUF-01", true, false) }
    }
    @Test fun `zamkniecie wymaga calej dostawy a nie tylko wybranej pozycji`() {
        assertThrows(IllegalArgumentException::class.java) { inboundClose(receiptDocument.copy(selected = receivedPart.copy(received = 12))) }
        val closed = inboundClose(receiptDocument.copy(summary = receiptDocument.summary.copy(remaining = 0), document = receiptDocument.document.copy(version = 8)))
        assertEquals("8", closed.body["version"]!!.jsonPrimitive.content)
        assertNull(closed.lineId)
    }
    @Test fun `dziennik przyjecia zachowuje tryb i identyfikatory bez zmiany zbiórki`() {
        val journal = WmsJournal(active = WmsActive(receiver, 5), putaway = WmsActivePutaway(receiver, 6),
            receiving = WmsActiveInbound(receiver, 1, 7, false))
        assertEquals(journal, WertisJson.decodeFromString<WmsJournal>(WertisJson.encodeToString(WmsJournal.serializer(), journal)))
        assertNull(WertisJson.decodeFromString<WmsJournal>("""{"active":{"context":{"server":"http://seeded/","actorId":2},"runId":5}}""").receiving)
    }
}

private class ReceivingStore : WmsStore {
    var journal = WmsJournal(active = WmsActive(receiver, 5), putaway = WmsActivePutaway(receiver, 6))
    var failWrite: (WmsJournal) -> Boolean = { false }
    override suspend fun read() = journal
    override suspend fun write(journal: WmsJournal) { if (failWrite(journal)) throw IOException("Dysk"); this.journal = journal }
}
private class ReceivingClient(private val store: ReceivingStore) : WmsInboundTransport {
    var current = receiptDocument
    var failure: Exception? = null
    var lostResponse = false
    var readFailure = false
    var lookupFailure = false
    var beforeRead: suspend () -> Unit = {}
    var beforeSend: suspend () -> Unit = {}
    val sent = mutableListOf<WmsPending>()
    val committed = mutableSetOf<String>()
    var requestedLine: Long? = null
    var requestedBarcode: String? = null
    override suspend fun documents(query: String, offset: Int) = WmsInboundList(listOf(current.document), 1)
    override suspend fun receiveDocument(id: Long, query: String, offset: Int, lineId: Long?, barcode: String?): WmsInboundDocument {
        beforeRead()
        if (readFailure) throw IOException()
        if (lookupFailure && barcode != null) throw ApiError(409, "Kolizja EAN")
        requestedLine = lineId; requestedBarcode = barcode
        return if (lineId != null || barcode != null) current else current.copy(selected = null)
    }
    override suspend fun send(command: WmsPending) {
        assertEquals(command, store.journal.pending)
        sent += command; beforeSend()
        failure?.let { throw it }
        if (committed.add(command.key)) {
            if (command.path.endsWith("/close")) current = current.copy(document = current.document.copy(closed_at = "2026-09-12", version = current.document.version + 1))
            else {
                val count = command.body["quantity"]!!.jsonPrimitive.int
                val line = current.selected!!
                current = current.copy(document = current.document.copy(version = current.document.version + 1),
                    selected = line.copy(received = line.received + count, version = line.version + 1),
                    summary = current.summary.copy(received = current.summary.received + count, remaining = current.summary.remaining - count))
            }
        }
        if (lostResponse) throw IOException("Utracono odpowiedź")
    }
}

class WmsInboundRecoveryTest {
    @Test fun `skan pobiera jedna pozycje i przechodzi do ilosci dopiero po odpowiedzi`() = runTest {
        val store = ReceivingStore(); val client = ReceivingClient(store); val controller = WmsInboundController(store, { client })
        controller.document(receiver, 1)
        val entered = CompletableDeferred<Unit>(); val release = CompletableDeferred<Unit>()
        client.beforeRead = { entered.complete(Unit); release.await() }
        val scanning = launch { controller.scan(receiver, "0590123") }
        entered.await(); val loadingGeneration = controller.state.value.generation
        assertFalse(controller.state.value.ready)
        release.complete(Unit); scanning.join()
        assertTrue(controller.state.value.generation > loadingGeneration)
        assertEquals("0590123", controller.state.value.confirmedBarcode)
        assertEquals("0590123", client.requestedBarcode)
        assertTrue(client.sent.isEmpty())
    }
    @Test fun `odpowiedz skanu po pauzie nie odtwarza potwierdzenia czesci`() = runTest {
        val store = ReceivingStore(); val client = ReceivingClient(store); val controller = WmsInboundController(store, { client })
        controller.document(receiver, 1)
        val entered = CompletableDeferred<Unit>(); val release = CompletableDeferred<Unit>()
        client.beforeRead = { entered.complete(Unit); release.await() }
        val scanning = launch { controller.scan(receiver, "0590123") }
        entered.await(); controller.invalidateVerification(); release.complete(Unit); scanning.join()
        assertNull(controller.state.value.confirmedBarcode)
    }
    @Test fun `czesciowe przyjecie odswieza tylko pozycje i wymaga nowego skanu`() = runTest {
        val store = ReceivingStore(); val client = ReceivingClient(store); val controller = WmsInboundController(store, { client })
        controller.document(receiver, 1); controller.scan(receiver, "0590123"); controller.submit(receiver, receiveDraft())
        assertEquals(7L, client.requestedLine)
        assertNull(client.requestedBarcode)
        assertNull(controller.state.value.confirmedBarcode)
        assertEquals(3, controller.state.value.document!!.selected!!.received)
        assertEquals(WmsActive(receiver, 5), store.journal.active)
        assertEquals(WmsActivePutaway(receiver, 6), store.journal.putaway)
    }
    @Test fun `restart po utracie odpowiedzi nie podwaja policzonej partii`() = runTest {
        val store = ReceivingStore(); val client = ReceivingClient(store); val controller = WmsInboundController(store, { client })
        controller.document(receiver, 1); controller.scan(receiver, "0590123")
        client.lostResponse = true; controller.submit(receiver, receiveDraft())
        val pending = store.journal.pending!!
        val restarted = WmsInboundController(store, { client }); restarted.open(receiver)
        assertFalse(restarted.state.value.ready)
        client.lostResponse = false; restarted.retry(receiver)
        assertEquals(pending, client.sent.last())
        assertEquals(1, client.committed.size)
        assertEquals(3, restarted.state.value.document!!.selected!!.received)
        assertNull(store.journal.pending)
    }
    @Test fun `odmowa dysku przed zapisem nie wysyla a po sukcesie zostawia klucz`() = runTest {
        for (before in listOf(true, false)) {
            val store = ReceivingStore(); val client = ReceivingClient(store); val controller = WmsInboundController(store, { client })
            controller.document(receiver, 1); controller.scan(receiver, "0590123")
            store.failWrite = { if (before) it.pending != null else it.pending == null }
            controller.submit(receiver, receiveDraft())
            assertFalse(controller.state.value.ready)
            if (before) assertTrue(client.sent.isEmpty()) else {
                assertNotNull(store.journal.pending); store.failWrite = { false }; controller.retry(receiver)
                assertEquals(1, client.committed.size)
            }
        }
    }
    @Test fun `inny serwer lub konto nie przejmuje ponowienia przyjecia`() = runTest {
        val store = ReceivingStore(); val client = ReceivingClient(store); val controller = WmsInboundController(store, { client })
        controller.document(receiver, 1); controller.scan(receiver, "0590123"); client.lostResponse = true; controller.submit(receiver, receiveDraft())
        for (foreign in listOf(receiver.copy(actorId = 3), receiver.copy(server = "http://foreign/"))) {
            controller.open(foreign); controller.retry(foreign); controller.documents(foreign)
            assertNotNull(store.journal.pending)
        }
        assertEquals(1, client.sent.size)
    }
    @Test fun `tylko rozstrzygnieta odmowa usuwa oczekujace przyjecie`() = runTest {
        val store = ReceivingStore(); val client = ReceivingClient(store); val controller = WmsInboundController(store, { client })
        controller.document(receiver, 1); controller.scan(receiver, "0590123"); client.failure = ApiError(403, "Sesja"); controller.submit(receiver, receiveDraft())
        assertNotNull(store.journal.pending)
        client.failure = ApiError(409, "Zmieniła się ilość"); controller.retry(receiver)
        assertNull(store.journal.pending)
        assertNull(controller.state.value.confirmedBarcode)
        assertEquals("Zmieniła się ilość", controller.state.value.message)
    }
    @Test fun `kolizja odczytu pozwala zeskanowac poprawny SKU bez zamkniecia dokumentu`() = runTest {
        val store = ReceivingStore(); val client = ReceivingClient(store); val controller = WmsInboundController(store, { client })
        controller.document(receiver, 1); client.lookupFailure = true; controller.scan(receiver, "0590123")
        assertTrue(controller.state.value.ready); assertNull(controller.state.value.document!!.selected)
        client.lookupFailure = false; controller.scan(receiver, "WMS-0030")
        assertEquals("WMS-0030", controller.state.value.confirmedBarcode)
    }
    @Test fun `tryb przyjecia przezywa restart i zmiana wymaga nowego skanu`() = runTest {
        val store = ReceivingStore(); val client = ReceivingClient(store); val controller = WmsInboundController(store, { client })
        controller.document(receiver, 1); controller.scan(receiver, "0590123"); controller.setBuffer(receiver, false)
        assertNull(controller.state.value.confirmedBarcode)
        val restarted = WmsInboundController(store, { client }); restarted.open(receiver)
        assertFalse(restarted.state.value.buffer)
        assertNull(restarted.state.value.confirmedBarcode)
    }
    @Test fun `zamkniecie po utracie odpowiedzi zachowuje identyczny klucz`() = runTest {
        val store = ReceivingStore(); val client = ReceivingClient(store)
        client.current = receiptDocument.copy(summary = receiptDocument.summary.copy(remaining = 0, received = 12))
        val controller = WmsInboundController(store, { client }); controller.document(receiver, 1)
        client.lostResponse = true; controller.submit(receiver, inboundClose(client.current))
        val pending = store.journal.pending!!; assertNull(pending.lineId)
        client.lostResponse = false; controller.retry(receiver)
        assertEquals(pending, client.sent.last()); assertEquals(1, client.committed.size)
        assertNotNull(controller.state.value.document!!.document.closed_at)
    }
    @Test fun `bledna odpowiedz dokumentu lub czesci nie odblokowuje liczenia`() = runTest {
        val store = ReceivingStore(); val client = ReceivingClient(store); val controller = WmsInboundController(store, { client })
        controller.document(receiver, 1)
        client.current = receiptDocument.copy(selected = receivedPart.copy(sku = "OBCA", barcode = "INNY"))
        controller.scan(receiver, "0590123"); assertFalse(controller.state.value.ready)
        client.current = receiptDocument.copy(document = receiptDocument.document.copy(id = 9))
        controller.document(receiver, 1); assertFalse(controller.state.value.ready)
    }
    @Test fun `blad odczytu po zapisie blokuje drugi ruch i mozna go odswiezyc`() = runTest {
        val store = ReceivingStore(); val client = ReceivingClient(store); val controller = WmsInboundController(store, { client })
        controller.document(receiver, 1); controller.scan(receiver, "0590123"); client.readFailure = true; controller.submit(receiver, receiveDraft())
        assertNull(store.journal.pending); assertFalse(controller.state.value.ready)
        controller.submit(receiver, receiveDraft()); assertEquals(1, client.sent.size)
        client.readFailure = false; controller.open(receiver); assertEquals(3, controller.state.value.document!!.selected!!.received)
    }
    @Test fun `anulowanie po utrwaleniu zapisu zachowuje go do ponowienia`() = runTest {
        val store = ReceivingStore(); val client = ReceivingClient(store); val controller = WmsInboundController(store, { client })
        controller.document(receiver, 1); controller.scan(receiver, "0590123"); client.failure = CancellationException()
        try { controller.submit(receiver, receiveDraft()); fail("Anulowanie musi wyjść") } catch (_: CancellationException) { }
        assertNotNull(store.journal.pending); assertFalse(controller.state.value.busy)
    }
    @Test fun `szybki drugi skan celu nie ustawia kolejnego zapisu w kolejce`() = runTest {
        val store = ReceivingStore(); val client = ReceivingClient(store); val controller = WmsInboundController(store, { client })
        controller.document(receiver, 1); controller.scan(receiver, "0590123")
        val entered = CompletableDeferred<Unit>(); val release = CompletableDeferred<Unit>()
        client.beforeSend = { entered.complete(Unit); release.await() }
        val sending = launch { controller.submit(receiver, receiveDraft()) }
        entered.await(); controller.submit(receiver, receiveDraft()); release.complete(Unit); sending.join()
        assertEquals(1, client.sent.size)
    }
}

class WmsReceivingSharedJournalTest {
    @Test fun `nieznana zbiorka i odkladanie nie sa nadpisywane przyjeciem`() = runTest {
        for (kind in listOf("picking", "putaway")) {
            val store = ReceivingStore(); val client = ReceivingClient(store); val controller = WmsInboundController(store, { client })
            controller.document(receiver, 1); controller.scan(receiver, "0590123")
            val pending = WmsPending("old", receiver, "api/wms/unknown", receiveDraft().body, "Poprzedni zapis", workflow = kind)
            store.journal = store.journal.copy(pending = pending)
            controller.submit(receiver, receiveDraft()); controller.retry(receiver)
            assertEquals(pending, store.journal.pending); assertTrue(client.sent.isEmpty())
        }
    }
    @Test fun `nieznane przyjecie blokuje zbiorke i odkladanie bez ponowienia obcym klientem`() = runTest {
        val store = ReceivingStore(); val client = ReceivingClient(store); val mutex = Mutex()
        val receiving = WmsInboundController(store, { client }, lock = mutex)
        var writes = 0
        val picking = WmsController(store, { object : WmsTransport {
            override suspend fun run(id: Long) = WmsRun(id, "CART-20", 2, orders = emptyList(), tasks = emptyList())
            override suspend fun send(command: WmsPending): Long? { writes++; return 5 }
        } }, lock = mutex)
        val putaway = WmsPutawayController(store, { object : WmsPutawayTransport {
            override suspend fun queue(query: String, offset: Int) = WmsPutawayQueue(emptyList(), WmsPutawayTotals(0, 0))
            override suspend fun putawayTask(id: Long) = WmsPutawayTask(id, 30, "BUF-01", 3, 3, 2, 1, "WMS-0030", "Koło", reference = "PZ-1")
            override suspend fun send(command: WmsPending) { writes++ }
        } }, lock = mutex)
        picking.open(receiver); putaway.select(receiver, 6); receiving.document(receiver, 1); receiving.scan(receiver, "0590123")
        client.lostResponse = true; receiving.submit(receiver, receiveDraft())
        val pending = store.journal.pending
        picking.submit(receiver, wmsScan(null, 2, WmsScanState(), "CART-20").command!!); picking.retry(receiver)
        val draft = putawayScan(putaway.state.value.task!!, 2, WmsPutawayScan(true, "WMS-0030", 1), "A-01").command!!
        putaway.submit(receiver, draft); putaway.retry(receiver)
        assertEquals(0, writes); assertEquals(pending, store.journal.pending)
    }
}
