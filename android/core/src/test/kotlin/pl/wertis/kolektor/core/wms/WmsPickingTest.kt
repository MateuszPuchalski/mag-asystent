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
    @Test fun `po przekierowaniu braku kolektor wymaga skanu nowej polki i czesci`() = runTest {
        val store = MemoryStore(); val client = FakeTransport(store)
        var current = route
        client.readAction = { current }
        client.sendAction = {
            current = route.copy(tasks = listOf(task.copy(bin = "B-02", version = 6, remaining = 2)))
            route.id
        }
        val controller = WmsController(store, { client })
        controller.open(who)
        controller.submit(who, wmsException(route, task, task.tote, "missing", "Brak na półce"))
        assertTrue(controller.state.value.ready)
        assertNull(controller.state.value.journal.pending)
        assertNull(controller.state.value.initialScan)
        assertEquals("B-02", controller.state.value.run!!.nextTask(2)!!.bin)
        assertEquals(WmsStage.LOCATION, wmsStage(controller.state.value.run, 2, WmsScanState()))
        assertNotNull(wmsScan(controller.state.value.run, 2, WmsScanState(), task.tote).error)
    }

    @Test fun `przekierowanie przez innego operatora odrzuca stary skan i usuwa weryfikacje przystanku`() = runTest {
        val store = MemoryStore(); val client = FakeTransport(store)
        var current = route
        client.readAction = { current }
        client.sendAction = {
            current = route.copy(tasks = listOf(task.copy(bin = "B-02", version = 5)))
            throw ApiError(409, "Tego pobrania nie zapisano. Odłóż niepotwierdzone sztuki na A-01.")
        }
        val controller = WmsController(store, { client })
        controller.open(who); controller.submit(who, pickDraft())
        assertTrue(controller.state.value.ready)
        assertNull(controller.state.value.journal.pending)
        assertNull(controller.state.value.initialScan)
        assertEquals("B-02", controller.state.value.run!!.nextTask(2)!!.bin)
        assertTrue(controller.state.value.message!!.contains("Odłóż niepotwierdzone sztuki"))
        assertEquals(1, client.sent.size)
    }

    @Test fun `potwierdzone przejecie pozwala jawnie rozpoczac kolejny wozek bez zapisu na serwerze`() = runTest {
        val store = MemoryStore(); val client = FakeTransport(store)
        client.readAction = { throw ApiError(403, "Przejęto", "WMS_RUN_REASSIGNED") }
        val controller = WmsController(store, { client })
        controller.open(who)
        assertTrue(controller.state.value.reassigned)
        assertNotNull(store.journal.active)
        controller.nextCart(who.copy(actorId = 3))
        assertNotNull(store.journal.active)
        controller.nextCart(who)
        assertEquals(WmsJournal(), store.journal)
        assertTrue(controller.state.value.ready)
        assertFalse(controller.state.value.reassigned)
        assertTrue(client.sent.isEmpty())
    }

    @Test fun `brak sieci i zwykle 403 nie pozwalaja porzucic aktywnej trasy`() = runTest {
        for (failure in listOf(IOException(), ApiError(403, "Sesja"), ApiError(404, "Nie ma"))) {
            val store = MemoryStore(); val client = FakeTransport(store)
            client.readAction = { throw failure }
            val controller = WmsController(store, { client })
            controller.open(who); controller.nextCart(who)
            assertFalse(controller.state.value.reassigned)
            assertFalse(controller.state.value.ready)
            assertNotNull(store.journal.active)
        }
    }

    @Test fun `odmowa po sprawdzeniu klucza i rollbacku rozlicza oczekujacy zapis po przejeciu`() = runTest {
        val store = MemoryStore(); val client = FakeTransport(store)
        val controller = WmsController(store, { client })
        controller.open(who)
        client.sendAction = { throw IOException() }
        controller.submit(who, pickDraft())
        val pending = store.journal.pending
        client.readAction = { throw ApiError(403, "Przejęto", "WMS_RUN_REASSIGNED") }
        controller.nextCart(who)
        assertEquals(pending, store.journal.pending)
        client.sendAction = { throw ApiError(403, "Odmowa po rollbacku", "WMS_COMMAND_REJECTED") }
        controller.retry(who)
        assertEquals(client.sent[0], client.sent[1])
        assertNull(store.journal.pending)
        assertTrue(controller.state.value.reassigned)
        controller.nextCart(who)
        assertTrue(controller.state.value.ready)
    }

    @Test fun `zatwierdzony przed przejeciem skan odzyskuje wynik i nie wysyla nowego klucza`() = runTest {
        val store = MemoryStore(); val client = FakeTransport(store)
        val controller = WmsController(store, { client })
        controller.open(who)
        client.sendAction = { throw IOException() }
        controller.submit(who, pickDraft())
        client.sendAction = { route.id }
        client.readAction = { route.copy(picker_id = 3) }
        controller.retry(who)
        assertNull(store.journal.pending)
        assertTrue(controller.state.value.reassigned)
        assertEquals(client.sent[0], client.sent[1])
        store.failWrite = { true }
        controller.nextCart(who)
        assertNotNull(store.journal.active)
        assertFalse(controller.state.value.ready)
        store.failWrite = { false }
        controller.nextCart(who)
        assertNull(store.journal.active)
    }

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

class WmsStopTest {
    private val next = task.copy(allocation_id = 8, order_id = 13, tote = "BOX-20-02", position = 2)
    private val before = route.copy(tasks = listOf(task, next))
    private val after = before.copy(tasks = listOf(next))
    private fun pending(): WmsPending {
        val draft = wmsScan(before, 2, WmsScanState(true, task.barcode, 3), task.tote).command!!
        return WmsPending("stop-key", who, draft.path, draft.body, draft.description, draft.runId)
    }

    @Test fun `trzydziesci skrzynek tej samej czesci wymaga 32 skanow zamiast 90`() = runTest {
        val store = MemoryStore()
        val client = FakeTransport(store)
        var current = route.copy(tasks = (1..30).map {
            task.copy(allocation_id = it.toLong(), order_id = it.toLong(), position = it, tote = "BOX-$it", remaining = 1, stop_quantity = 30)
        })
        client.readAction = { current }
        client.sendAction = {
            current = current.copy(tasks = current.tasks.drop(1).map { t -> t.copy(stop_quantity = current.tasks.size - 1) })
            route.id
        }
        val controller = WmsController(store, { client })
        controller.open(who)
        var scans = 0
        while (controller.state.value.run!!.tasks.isNotEmpty()) {
            val view = controller.state.value
            val run = view.run!!
            val target = run.nextTask(2)!!
            var scan = view.initialScan ?: WmsScanState(quantity = target.remaining)
            if (!scan.location) { scan = wmsScan(run, 2, scan, target.bin).state; scans++ }
            if (scan.barcode == null) { scan = wmsScan(run, 2, scan, target.barcode!!).state; scans++ }
            val result = wmsScan(run, 2, scan, target.tote)
            assertNull(result.error)
            controller.submit(who, result.command!!)
            scans++
        }
        assertEquals(32, scans)
        assertEquals(30, client.sent.size)
        assertEquals(30, client.sent.map { it.body["tote"] }.distinct().size)
        assertNull(controller.state.value.initialScan)
    }

    @Test fun `inna polka czesc kod wlasciciel lub blokada przerywa kontynuacje`() {
        val variants = listOf(
            after.copy(tasks = listOf(next.copy(bin = "B-01"))),
            after.copy(tasks = listOf(next.copy(tw_id = 31))),
            after.copy(tasks = listOf(next.copy(sku = "OTHER"))),
            after.copy(tasks = listOf(next.copy(barcode = "OTHER"))),
            after.copy(tasks = listOf(next.copy(name = "Inna część"))),
            after.copy(tasks = listOf(next.copy(stock_blocked = "Spis"))),
            after.copy(tasks = listOf(next.copy(hold_reason = "Wstrzymane"))),
            after.copy(tasks = listOf(next.copy(position = null))),
            after.copy(picker_id = 3), after.copy(cart_code = "OTHER"),
            after.copy(arrived_at = "2026-09-12"), after.copy(id = 6),
        )
        variants.forEach { assertNull(continueWmsStop(before, it, pending())) }
        assertEquals(WmsScanState(true, task.barcode, next.remaining), continueWmsStop(before, after, pending()))
    }

    @Test fun `czesciowe pobranie wymaga potwierdzonego ubytku i nowej wersji`() {
        val draft = pickDraft()
        val command = WmsPending("partial", who, draft.path, draft.body, draft.description, draft.runId)
        assertNull(continueWmsStop(route, route, command))
        val fresh = route.copy(tasks = listOf(task.copy(remaining = 1, version = 5)))
        assertEquals(WmsScanState(true, task.barcode, 1), continueWmsStop(route, fresh, command))
        assertNull(continueWmsStop(route, fresh.copy(tasks = listOf(task.copy(remaining = 2, version = 5))), command))
    }

    @Test fun `odswiezenie nawet identycznej trasy usuwa weryfikacje przystanku`() = runTest {
        val store = MemoryStore()
        val client = FakeTransport(store)
        client.readAction = { before }
        val controller = WmsController(store, { client })
        controller.open(who)
        client.readAction = { after }
        val p = pending()
        controller.submit(who, WmsDraft(p.path, p.body, p.description, p.runId))
        assertNotNull(controller.state.value.initialScan)
        controller.open(who)
        assertNull(controller.state.value.initialScan)
    }

    @Test fun `ponowienie po utracie odpowiedzi wymaga nowych skanow`() = runTest {
        val store = MemoryStore()
        val client = FakeTransport(store)
        client.readAction = { before }
        val controller = WmsController(store, { client })
        controller.open(who)
        client.readAction = { after }
        client.sendAction = { throw IOException() }
        val p = pending()
        controller.submit(who, WmsDraft(p.path, p.body, p.description, p.runId))
        client.sendAction = { route.id }
        controller.retry(who)
        assertTrue(controller.state.value.ready)
        assertNull(controller.state.value.initialScan)
    }

    @Test fun `wyjscie podczas zapisu na serwerze odbiera prawo kontynuacji`() = runTest {
        val store = MemoryStore()
        val client = FakeTransport(store)
        val entered = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        client.readAction = { before }
        val controller = WmsController(store, { client })
        controller.open(who)
        client.readAction = { after }
        client.sendAction = { entered.complete(Unit); release.await(); route.id }
        val p = pending()
        val job = launch { controller.submit(who, WmsDraft(p.path, p.body, p.description, p.runId)) }
        entered.await()
        controller.invalidateVerification()
        release.complete(Unit)
        job.join()
        assertNull(controller.state.value.initialScan)
    }

    @Test fun `wyjscie podczas zapisu na dysku takze wymaga nowych skanow`() = runTest {
        val memory = MemoryStore()
        val entered = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        val store = object : WmsStore {
            override suspend fun read() = memory.read()
            override suspend fun write(journal: WmsJournal) {
                if (journal.pending != null) { entered.complete(Unit); release.await() }
                memory.write(journal)
            }
        }
        val client = FakeTransport(memory)
        client.readAction = { before }
        val controller = WmsController(store, { client })
        controller.open(who)
        client.readAction = { after }
        val p = pending()
        val job = launch { controller.submit(who, WmsDraft(p.path, p.body, p.description, p.runId)) }
        entered.await()
        controller.invalidateVerification()
        release.complete(Unit)
        job.join()
        assertNull(controller.state.value.initialScan)
    }

    @Test fun `zgloszenie i niezgodne dane polecenia nie potwierdzaja przystanku`() {
        assertNull(continueWmsStop(before, after, pending().copy(path = "api/wms/pick-exceptions")))
        assertNull(continueWmsStop(before, after, pending().copy(context = who.copy(actorId = 3))))
        assertNull(continueWmsStop(before, after, pending().copy(runId = 99)))
    }
}
