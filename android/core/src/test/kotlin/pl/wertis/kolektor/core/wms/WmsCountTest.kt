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

private val counter = WmsContext("http://seeded/", 2)
private val countTask = WmsCountTask(1, 30, "A-01", "LOC:PART", "Koło", "0590123", 4, reason = "Brak")
private fun countCommand() = countDraft(countTask, WmsCountScan(true, countTask.barcode), "7")

class WmsCountScanTest {
    @Test fun `polka czesc i jawna ilosc tworza dopiero obserwacje`() {
        assertThrows(IllegalArgumentException::class.java) { countScan(countTask, WmsCountScan(), "BAD") }
        var scan = countScan(countTask, WmsCountScan(), "a-01")
        assertThrows(IllegalArgumentException::class.java) { countScan(countTask, scan, "590123") }
        scan = countScan(countTask, scan, "0590123")
        val command = countDraft(countTask, scan, "0")
        assertEquals("0", command.body["quantity"]!!.jsonPrimitive.content)
        assertEquals("4", command.body["version"]!!.jsonPrimitive.content)
        assertEquals("api/wms/stock-checks/1/observe", command.path)
    }
    @Test fun `puste ulamkowe ujemne i zbyt duze liczenie nie wysyla zera`() {
        for (raw in listOf("", " ", "-1", "1.5", "1000001", "999999999999999")) {
            assertThrows(IllegalArgumentException::class.java) { countDraft(countTask, WmsCountScan(true, "0590123"), raw) }
        }
        assertThrows(IllegalArgumentException::class.java) { countDraft(countTask, WmsCountScan(), "0") }
    }
    @Test fun `kod lokalizacji normalizuje sie tylko przy skanie polki`() {
        assertEquals("A-01", countCode(WmsCountStage.BIN, classify("LOC:A-01")))
        assertEquals("LOC:PART", countCode(WmsCountStage.PRODUCT, classify("LOC:PART")))
        assertEquals("LOC:PART", countScan(countTask, WmsCountScan(true), "LOC:PART").barcode)
    }
    @Test fun `oczekujacy i zakonczony wynik nie dopuszcza kolejnego liczenia`() {
        for (task in listOf(countTask.copy(pending = 1), countTask.copy(resolved_at = "2026-09-12"))) {
            assertThrows(IllegalArgumentException::class.java) { countDraft(task, WmsCountScan(true, task.barcode), "7") }
        }
        assertEquals(WmsCountStage.PENDING, countStage(countTask.copy(pending = 1), WmsCountScan()))
    }
    @Test fun `starszy dziennik zachowuje proces a nowe liczenie przechodzi serializacje`() {
        val old = WertisJson.decodeFromString<WmsJournal>("{}")
        assertNull(old.counting)
        val journal = old.copy(counting = WmsActiveCount(counter, 1))
        assertEquals(journal, WertisJson.decodeFromString<WmsJournal>(WertisJson.encodeToString(WmsJournal.serializer(), journal)))
    }
}
private class CountStore : WmsStore {
    var journal = WmsJournal(active = WmsActive(counter, 5))
    var reject: (WmsJournal) -> Boolean = { false }
    override suspend fun read() = journal
    override suspend fun write(journal: WmsJournal) { if (reject(journal)) throw IOException("Dysk"); this.journal = journal }
}
private class CountClient(val store: CountStore) : WmsCountTransport {
    var task = countTask
    var failure: Exception? = null
    var lost = false
    var getFailure = false
    var beforeGet: suspend () -> Unit = {}
    val sent = mutableListOf<WmsPending>()
    val commits = mutableSetOf<String>()
    override suspend fun queue(query: String, offset: Int) = WmsCountQueue(listOf(task), WmsCountTotals(1))
    override suspend fun countingTask(id: Long): WmsCountTask {
        beforeGet()
        if (getFailure) throw IOException("Odczyt")
        return task
    }
    override suspend fun send(command: WmsPending) {
        assertEquals(command, store.journal.pending)
        sent += command
        failure?.let { throw it }
        if (commits.add(command.key)) task = task.copy(pending = 1)
        if (lost) throw IOException("Utracona odpowiedź")
    }
}
class WmsCountRecoveryTest {
    @Test fun `restart po utracie odpowiedzi ponawia ten sam wynik bez drugiej obserwacji`() = runTest {
        val store = CountStore(); val client = CountClient(store); val controller = WmsCountController(store, { client })
        controller.select(counter, 1); client.lost = true; controller.submit(counter, countCommand())
        val pending = store.journal.pending!!
        assertEquals("counting", pending.workflow)
        assertEquals(WmsActive(counter, 5), store.journal.active)
        val restart = WmsCountController(store, { client })
        restart.open(counter); assertFalse(restart.state.value.ready)
        client.lost = false; restart.retry(counter)
        assertEquals(pending, client.sent.last()); assertEquals(1, client.commits.size)
        assertNull(store.journal.pending); assertEquals(1, restart.state.value.task!!.pending)
    }
    @Test fun `blad dysku przed wyslaniem nie zapisuje a po potwierdzeniu zachowuje klucz`() = runTest {
        val store = CountStore(); val client = CountClient(store); val controller = WmsCountController(store, { client })
        controller.select(counter, 1); store.reject = { it.pending != null }; controller.submit(counter, countCommand())
        assertTrue(client.sent.isEmpty())
        store.reject = { false }; controller.open(counter)
        store.reject = { it.pending == null }; controller.submit(counter, countCommand())
        assertNotNull(store.journal.pending)
        store.reject = { false }; controller.retry(counter)
        assertNull(store.journal.pending); assertEquals(1, client.commits.size)
    }
    @Test fun `inny serwer konto i proces nie ponawiaja wyniku`() = runTest {
        val store = CountStore(); val client = CountClient(store); val controller = WmsCountController(store, { client })
        controller.select(counter, 1); client.lost = true; controller.submit(counter, countCommand())
        for (context in listOf(counter.copy(actorId = 3), counter.copy(server = "http://other/"))) {
            controller.open(context); controller.retry(context); controller.queue(context)
            assertFalse(controller.state.value.ready)
        }
        assertEquals(1, client.sent.size)
        store.journal = store.journal.copy(pending = store.journal.pending!!.copy(workflow = "putaway"))
        controller.open(counter); controller.retry(counter)
        assertEquals(1, client.sent.size)
    }
    @Test fun `stare dane odrzucone przez serwer wymagaja swiezych skanow`() = runTest {
        val store = CountStore(); val client = CountClient(store); val controller = WmsCountController(store, { client })
        controller.select(counter, 1); val generation = controller.state.value.generation
        client.task = countTask.copy(version = 5); client.failure = ApiError(409, "Policz ponownie")
        controller.submit(counter, countCommand())
        assertNull(store.journal.pending); assertEquals(5, controller.state.value.task!!.version)
        assertTrue(controller.state.value.generation > generation)
        assertEquals("Policz ponownie", controller.state.value.message)
    }
    @Test fun `nieudany odczyt po zapisie blokuje nastepne liczenie`() = runTest {
        val store = CountStore(); val client = CountClient(store); val controller = WmsCountController(store, { client })
        controller.select(counter, 1); client.getFailure = true; controller.submit(counter, countCommand())
        assertNull(store.journal.pending); assertFalse(controller.state.value.ready)
        controller.submit(counter, countCommand()); assertEquals(1, client.sent.size)
    }
    @Test fun `odpowiedz przychodzaca po uspieniu ekranu nie wlacza skanowania`() = runTest {
        val store = CountStore(); val client = CountClient(store); val controller = WmsCountController(store, { client })
        val started = CompletableDeferred<Unit>(); val finish = CompletableDeferred<Unit>()
        client.beforeGet = { started.complete(Unit); finish.await() }
        val read = launch { controller.select(counter, 1) }
        started.await(); controller.invalidateVerification(); finish.complete(Unit); read.join()
        assertFalse(controller.state.value.ready)
        controller.submit(counter, countCommand()); assertTrue(client.sent.isEmpty())
    }
}
