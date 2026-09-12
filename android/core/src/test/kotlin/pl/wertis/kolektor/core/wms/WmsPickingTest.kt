package pl.wertis.kolektor.core.wms

import java.io.IOException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.*
import org.junit.Test
import pl.wertis.kolektor.core.net.ApiError
import pl.wertis.kolektor.core.net.WertisJson
import pl.wertis.kolektor.core.scan.classify

private val who = WmsContext("http://warehouse/", 2)
private val task = WmsTask(7, 12, 4, 30, "WMS0030", "Koło kosiarki", "0590123456789", "A-01", "BOX-20-01", 1, 3, 9, 2)
private val route = WmsRun(5, "CART-20", 2, orders = listOf(WmsOrder(12, "picking")), tasks = listOf(task))
private fun pickDraft() = wmsScan(route, 2, WmsScanState(true, task.barcode, 2), task.tote).command!!

class WmsPickingTest {
    @Test fun `prefiks lokalizacji w kodzie czesci nie podmienia towaru`() {
        val input = classify("LOC:WMS0030")
        val code = wmsScanCode(WmsStage.PRODUCT, input)
        assertEquals("LOC:WMS0030", code)
        assertNotNull(wmsScan(route, 2, WmsScanState(location = true), code).error)
        val actual = route.copy(tasks = listOf(task.copy(sku = "LOC:WMS0030")))
        assertNull(wmsScan(actual, 2, WmsScanState(location = true), code).error)
        assertEquals("LOC:WMS0030", wmsScanCode(WmsStage.BOX, input))
    }

    @Test fun `etykieta lokalizacji zachowuje obsluge prefiksu w kroku polki`() {
        val code = wmsScanCode(WmsStage.LOCATION, classify("LOC:a-01"))
        assertEquals("A-01", code)
        assertTrue(wmsScan(route, 2, WmsScanState(), code).state.location)
    }

    @Test fun `polka czesc skrzynka a ilosc dopiero po potwierdzeniu`() {
        var scan = WmsScanState(quantity = 2)
        assertNotNull(wmsScan(route, 2, scan, task.tote).error)
        scan = wmsScan(route, 2, scan, task.bin).state
        assertEquals(WmsStage.PRODUCT, wmsStage(route, 2, scan))
        assertNotNull(wmsScan(route, 2, scan, "INNA-CZESC").error)
        scan = wmsScan(route, 2, scan, task.barcode!!).state
        assertEquals(WmsStage.BOX, wmsStage(route, 2, scan))
        assertNotNull(wmsScan(route, 2, scan, "BOX-20-02").error)
        val command = wmsScan(route, 2, scan, task.tote).command!!
        assertEquals("2", command.body["quantity"]?.jsonPrimitive?.content)
        assertEquals(task.barcode, command.body["barcode"]?.jsonPrimitive?.content)
        assertEquals(3, route.tasks.single().remaining)
    }

    @Test fun `kod ze wiodacym zerem i SKU dzialaja a obcy EAN nie`() {
        val verified = WmsScanState(location = true)
        assertNotNull(wmsScan(route, 2, verified, task.barcode!!.drop(1)).error)
        assertNull(wmsScan(route, 2, verified, "wms0030").error)
        assertNull(wmsScan(route, 2, verified, task.barcode!!).error)
    }

    @Test fun `zerowa ujemna i nadmierna ilosc nie tworzy zapisu`() {
        for (qty in listOf(0, -1, 4, Int.MAX_VALUE)) {
            val result = wmsScan(route, 2, WmsScanState(true, task.barcode, qty), task.tote)
            assertNull(result.command)
            assertNotNull(result.error)
        }
    }

    @Test fun `blokada stanu lub zamowienia i cudzy picker nie tworza zadania`() {
        assertNull(route.copy(tasks = listOf(task.copy(stock_blocked = "Kontrola"))).nextTask(2))
        assertNull(route.copy(tasks = listOf(task.copy(hold_reason = "Stop"))).nextTask(2))
        assertEquals(WmsStage.WAIT, wmsStage(route, 3, WmsScanState()))
        assertEquals(WmsStage.WAIT, wmsStage(route.copy(tasks = emptyList()), 2, WmsScanState()))
        assertEquals(WmsStage.WAIT, wmsStage(route.copy(tasks = listOf(task.copy(position = null))), 2, WmsScanState()))
    }

    @Test fun `przekazanie wymaga skonczonych zamowien i skanu wlasnego wozka`() {
        val ready = route.copy(orders = listOf(WmsOrder(12, "picked")), tasks = emptyList())
        assertNotNull(wmsScan(ready, 2, WmsScanState(), "PACK-01").error)
        val scan = wmsScan(ready, 2, WmsScanState(), ready.cart_code).state
        val result = wmsScan(ready, 2, scan, "PACK-01")
        assertEquals("PACK-01", result.command!!.body["station"]?.jsonPrimitive?.content)
        assertEquals(WmsStage.DONE, wmsStage(ready.copy(arrived_at = "2026-09-12"), 2, scan))
    }

    @Test fun `zgloszenie wymaga wlasciwej skrzynki i utrwala wersje`() {
        assertThrows(IllegalArgumentException::class.java) { wmsException(route, task, "INNA", "missing", "Brak towaru") }
        val command = wmsException(route, task, task.tote, "missing", "Brak towaru")
        assertEquals("4", command.body["version"]?.jsonPrimitive?.content)
        assertEquals("12", command.body["orderId"]?.jsonPrimitive?.content)
        assertFalse(command.body.containsKey("runId"))
    }

    @Test fun `dziennik JSON zachowuje klucz kontekst EAN i ilosc`() {
        val draft = pickDraft()
        val journal = WmsJournal(WmsPending("fixed-key", who, draft.path, draft.body, draft.description, draft.runId), WmsActive(who, 5))
        assertEquals(journal, WertisJson.decodeFromString<WmsJournal>(WertisJson.encodeToString(WmsJournal.serializer(), journal)))
    }
}

private class MemoryStore : WmsStore {
    var journal = WmsJournal(active = WmsActive(who, route.id))
    var failWrite: (WmsJournal) -> Boolean = { false }
    override suspend fun read() = journal
    override suspend fun write(journal: WmsJournal) {
        if (failWrite(journal)) throw IOException("Dysk")
        this.journal = journal
    }
}

private class FakeTransport(private val store: MemoryStore) : WmsTransport {
    val sent = mutableListOf<WmsPending>()
    var sendAction: suspend (WmsPending) -> Long? = { it.runId ?: route.id }
    var readAction: suspend () -> WmsRun = { route }
    override suspend fun send(command: WmsPending): Long? {
        assertEquals(command, store.journal.pending)
        sent += command
        return sendAction(command)
    }
    override suspend fun run(id: Long) = readAction()
}

class WmsRecoveryTest {
    @Test fun `utrata odpowiedzi restart i ponowienie zachowuja dokladnie jeden klucz`() = runTest {
        val store = MemoryStore()
        val client = FakeTransport(store)
        client.sendAction = { throw IOException("Odpowiedź zginęła po zapisie") }
        val first = WmsController(store, { client })
        first.open(who)
        first.submit(who, pickDraft())
        val pending = store.journal.pending!!
        assertFalse(first.state.value.ready)
        first.submit(who, pickDraft())
        assertEquals(1, client.sent.size)
        val restarted = WmsController(store, { client })
        restarted.open(who)
        client.sendAction = { route.id }
        restarted.retry(who)
        assertEquals(listOf(pending, pending), client.sent)
        assertNull(store.journal.pending)
        assertTrue(restarted.state.value.ready)
    }

    @Test fun `brak miejsca na dysku blokuje wyslanie`() = runTest {
        val store = MemoryStore()
        val client = FakeTransport(store)
        val controller = WmsController(store, { client })
        controller.open(who)
        store.failWrite = { true }
        controller.submit(who, pickDraft())
        assertTrue(client.sent.isEmpty())
        assertFalse(controller.state.value.ready)
    }

    @Test fun `awaria usuniecia dziennika po sukcesie pozostawia bezpieczne ponowienie`() = runTest {
        val store = MemoryStore()
        val client = FakeTransport(store)
        val controller = WmsController(store, { client })
        controller.open(who)
        store.failWrite = { it.pending == null }
        controller.submit(who, pickDraft())
        assertNotNull(store.journal.pending)
        store.failWrite = { false }
        controller.retry(who)
        assertEquals(client.sent[0], client.sent[1])
        assertTrue(controller.state.value.ready)
    }

    @Test fun `zmiana uzytkownika lub serwera nie przenosi oczekujacej operacji`() = runTest {
        val store = MemoryStore()
        val client = FakeTransport(store)
        client.sendAction = { throw IOException() }
        val controller = WmsController(store, { bound -> assertEquals(who, bound); client })
        controller.open(who)
        controller.submit(who, pickDraft())
        for (other in listOf(who.copy(actorId = 3), who.copy(server = "http://other/"))) {
            controller.open(other)
            controller.retry(other)
            controller.submit(other, pickDraft())
            assertFalse(controller.state.value.ready)
            assertEquals(1, client.sent.size)
        }
    }

    @Test fun `odmowa biznesowa odswieza trase bez automatycznego powtorzenia`() = runTest {
        val store = MemoryStore()
        val client = FakeTransport(store)
        val controller = WmsController(store, { client })
        controller.open(who)
        client.sendAction = { throw ApiError(409, "Wersja zmieniona") }
        controller.submit(who, pickDraft())
        assertNull(store.journal.pending)
        assertTrue(controller.state.value.ready)
        assertEquals("Wersja zmieniona", controller.state.value.message)
    }

    @Test fun `blad autoryzacji limit i blad serwera zachowuja nieznany wynik`() = runTest {
        for (status in listOf(401, 403, 408, 429, 500, 503)) {
            val store = MemoryStore()
            val client = FakeTransport(store)
            val controller = WmsController(store, { client })
            controller.open(who)
            client.sendAction = { throw ApiError(status, "Odmowa") }
            controller.submit(who, pickDraft())
            assertNotNull(store.journal.pending)
            assertFalse(controller.state.value.ready)
        }
    }

    @Test fun `utrata odczytu po potwierdzonym zapisie wymaga tylko odswiezenia`() = runTest {
        val store = MemoryStore()
        val client = FakeTransport(store)
        val controller = WmsController(store, { client })
        controller.open(who)
        client.readAction = { throw IOException() }
        controller.submit(who, pickDraft())
        assertNull(store.journal.pending)
        assertFalse(controller.state.value.ready)
        client.readAction = { route }
        controller.open(who)
        assertTrue(controller.state.value.ready)
        assertEquals(1, client.sent.size)
    }

    @Test fun `drugi skan w locie nie czeka w kolejce do powtornego zapisu`() = runTest {
        val store = MemoryStore()
        val client = FakeTransport(store)
        val entered = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        client.sendAction = { entered.complete(Unit); release.await(); route.id }
        val controller = WmsController(store, { client })
        controller.open(who)
        val job = launch { controller.submit(who, pickDraft()) }
        entered.await()
        controller.submit(who, pickDraft())
        release.complete(Unit)
        job.join()
        assertEquals(1, client.sent.size)
    }

    @Test fun `uszkodzony dziennik nie staje sie pustym bez pytania`() = runTest {
        val broken = object : WmsStore {
            override suspend fun read(): WmsJournal = throw IOException("Nieczytelny dziennik")
            override suspend fun write(journal: WmsJournal) = fail("Nie wolno nadpisać")
        }
        val controller = WmsController(broken, { error("Nie wolno wysłać") })
        controller.open(who)
        controller.submit(who, pickDraft())
        assertFalse(controller.state.value.ready)
    }

    @Test fun `po zmianie wlasciciela nie wolno wznowic cudzej trasy`() = runTest {
        val store = MemoryStore()
        val client = FakeTransport(store)
        client.readAction = { route.copy(picker_id = 3) }
        val controller = WmsController(store, { client })
        controller.open(who)
        assertFalse(controller.state.value.ready)
        assertNull(controller.state.value.run)
    }
}
