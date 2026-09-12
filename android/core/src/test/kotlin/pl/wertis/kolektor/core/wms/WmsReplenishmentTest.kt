package pl.wertis.kolektor.core.wms

import java.io.IOException
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.*
import org.junit.Test
import pl.wertis.kolektor.core.net.ApiError
import pl.wertis.kolektor.core.net.WertisJson
import pl.wertis.kolektor.core.scan.classify

private val replenisher = WmsContext("http://seeded/", 2)
private val replenishTask = WmsReplenishmentTask(1, 30, "LOC:PART", "Nóż", "005901", "RES-01", "A-01", 4, 2)
private val replenishPlan = WmsReplenishmentPlan(30, "LOC:PART", "Nóż", "005901", "RES-01", "A-01", 4, 10, 2, 3)
private fun replenishCommand() = replenishmentFinish(replenishTask, 2, WmsReplenishmentScan(true, "005901", 4), "A-01")

class WmsReplenishmentScanTest {
    @Test fun `pelny cel wymaga ilosci na celu jego skanu i zwrotu pozostalych sztuk`() {
        var scan = replenishmentSpaceStart(replenishTask, 2, WmsReplenishmentScan(true, "005901", 4))
        for (raw in listOf("", "-1", "1.5", "4", "5"))
            assertThrows(IllegalArgumentException::class.java) { replenishmentSpaceQuantity(replenishTask, 2, scan, raw, "Brak miejsca") }
        assertThrows(IllegalArgumentException::class.java) { replenishmentSpaceQuantity(replenishTask, 2, scan, "2", "") }
        scan = replenishmentSpaceQuantity(replenishTask, 2, scan, "2", "Brak miejsca")
        assertThrows(IllegalArgumentException::class.java) { replenishmentSpaceFinish(replenishTask, 2, scan, "RES-01") }
        assertThrows(IllegalArgumentException::class.java) { replenishmentSpaceTarget(replenishTask, 2, scan, "BAD") }
        scan = replenishmentSpaceTarget(replenishTask, 2, scan, "a-01")
        assertThrows(IllegalArgumentException::class.java) { replenishmentSpaceFinish(replenishTask, 2, scan, "A-01") }
        val draft = replenishmentSpaceFinish(replenishTask, 2, scan, "res-01")
        assertEquals("2", draft.body["quantity"]!!.jsonPrimitive.content)
        assertEquals("4", draft.body["pickedQuantity"]!!.jsonPrimitive.content)
        assertEquals("true", draft.body["targetFull"]!!.jsonPrimitive.content)
        assertEquals("RES-01", draft.body["returnedSource"]!!.jsonPrimitive.content)
    }
    @Test fun `brak zrodla i miejsca zachowuje osobne ilosci oraz oba opisy`() {
        var scan = replenishmentQuantity(replenishTask, 2, WmsReplenishmentScan(true, "005901"), "2", "Brak na źródle")
        scan = replenishmentSpaceStart(replenishTask, 2, scan)
        scan = replenishmentSpaceQuantity(replenishTask, 2, scan, "1", "Brak miejsca")
        scan = replenishmentSpaceTarget(replenishTask, 2, scan, "A-01")
        val draft = replenishmentSpaceFinish(replenishTask, 2, scan, "RES-01")
        assertEquals("2", draft.body["pickedQuantity"]!!.jsonPrimitive.content)
        assertEquals("1", draft.body["quantity"]!!.jsonPrimitive.content)
        assertEquals("Brak na źródle; Brak miejsca", draft.body["reason"]!!.jsonPrimitive.content)
        assertEquals(WmsReplenishmentStage.SOURCE, replenishmentStage(replenishTask, 2, WmsReplenishmentScan()))
    }
    @Test fun `zero na pelnym celu wciaz wymaga zwrotu a lokalizacje rozpoznaja prefiks`() {
        assertThrows(IllegalArgumentException::class.java) { replenishmentSpaceStart(replenishTask, 2, WmsReplenishmentScan()) }
        var scan = replenishmentSpaceStart(replenishTask, 2, WmsReplenishmentScan(true, "005901", 4))
        scan = replenishmentSpaceQuantity(replenishTask, 2, scan, "0", "Cel pełny")
        scan = replenishmentSpaceTarget(replenishTask, 2, scan, replenishmentCode(WmsReplenishmentStage.SPACE_TARGET, classify("LOC:A-01")))
        val draft = replenishmentSpaceFinish(replenishTask, 2, scan, replenishmentCode(WmsReplenishmentStage.SPACE_RETURN, classify("LOC:RES-01")))
        assertEquals("0", draft.body["quantity"]!!.jsonPrimitive.content)
        assertThrows(IllegalArgumentException::class.java) { replenishmentSpaceFinish(replenishTask.copy(blocked = "Przelicz"), 2, scan, "RES-01") }
        assertThrows(IllegalArgumentException::class.java) { replenishmentSpaceFinish(replenishTask, 3, scan, "RES-01") }
    }
    @Test fun `zrodlo czesc ilosc cel chronia przed zlym odlozeniem`() {
        assertThrows(IllegalArgumentException::class.java) { replenishmentScan(replenishTask, 2, WmsReplenishmentScan(), "A-01") }
        var scan = replenishmentScan(replenishTask, 2, WmsReplenishmentScan(), "res-01")
        assertThrows(IllegalArgumentException::class.java) { replenishmentScan(replenishTask, 2, scan, "5901") }
        scan = replenishmentScan(replenishTask, 2, scan, "005901")
        assertThrows(IllegalArgumentException::class.java) { replenishmentFinish(replenishTask, 2, scan, "A-01") }
        scan = replenishmentQuantity(replenishTask, 2, scan, "4", "")
        assertThrows(IllegalArgumentException::class.java) { replenishmentFinish(replenishTask, 2, scan, "B-01") }
        val command = replenishmentFinish(replenishTask, 2, scan, "a-01")
        assertEquals("4", command.body["quantity"]!!.jsonPrimitive.content)
        assertEquals("005901", command.body["barcode"]!!.jsonPrimitive.content)
        assertNull(command.body["reason"])
    }
    @Test fun `czesciowa i zerowa ilosc wymaga opisu braku`() {
        val scan = WmsReplenishmentScan(true, "005901")
        for (quantity in listOf("0", "2")) {
            assertThrows(IllegalArgumentException::class.java) { replenishmentQuantity(replenishTask, 2, scan, quantity, " ") }
            val confirmed = replenishmentQuantity(replenishTask, 2, scan, quantity, " Brak na źródle ")
            val draft = replenishmentFinish(replenishTask, 2, confirmed, "A-01")
            assertEquals(quantity, draft.body["quantity"]!!.jsonPrimitive.content)
            assertEquals("Brak na źródle", draft.body["reason"]!!.jsonPrimitive.content)
        }
        for (quantity in listOf("", "-1", "1.5", "5", "9999999999999"))
            assertThrows(IllegalArgumentException::class.java) { replenishmentQuantity(replenishTask, 2, scan, quantity, "Brak") }
    }
    @Test fun `wlasny otwarty przydzial jest konieczny a anulowanie wymaga zwrotu na zrodlo`() {
        for (task in listOf(replenishTask.copy(user_id = 3), replenishTask.copy(completed_at = "done"), replenishTask.copy(cancelled_at = "done"), replenishTask.copy(blocked = "Przelicz")))
            assertThrows(IllegalArgumentException::class.java) { replenishmentFinish(task, 2, WmsReplenishmentScan(true, "005901", 4), "A-01") }
        assertThrows(IllegalArgumentException::class.java) { replenishmentCancel(replenishTask, 2, "A-01", "Zwrot") }
        assertThrows(IllegalArgumentException::class.java) { replenishmentCancel(replenishTask, 3, "RES-01", "Zwrot") }
        assertThrows(IllegalArgumentException::class.java) { replenishmentCancel(replenishTask, 2, "RES-01", "") }
        val draft = replenishmentCancel(replenishTask.copy(blocked = "Przelicz"), 2, "res-01", "Odłożono wszystkie sztuki")
        assertEquals("RES-01", draft.body["source"]!!.jsonPrimitive.content)
        assertTrue(draft.path.endsWith("/cancel"))
    }
    @Test fun `prefiks LOC zachowuje sie w kodzie czesci a duzy plan ogranicza ilosc`() {
        assertEquals("RES-01", replenishmentCode(WmsReplenishmentStage.SOURCE, classify("LOC:RES-01")))
        assertEquals("A-01", replenishmentCode(WmsReplenishmentStage.TARGET, classify("LOC:A-01")))
        assertEquals("LOC:PART", replenishmentCode(WmsReplenishmentStage.PRODUCT, classify("LOC:PART")))
        assertEquals("LOC:PART", replenishmentScan(replenishTask, 2, WmsReplenishmentScan(true), "LOC:PART").barcode)
        assertEquals(1000000, replenishPlan.copy(quantity = Long.MAX_VALUE, source_available = Long.MAX_VALUE).take)
        assertEquals(2, replenishPlan.copy(source_available = 2).take)
        assertThrows(IllegalArgumentException::class.java) { replenishmentClaim(replenishPlan.copy(source_available = 0)) }
        assertEquals("2", replenishmentClaim(replenishPlan).body["sourceVersion"]!!.jsonPrimitive.content)
    }
    @Test fun `stary dziennik pozostaje czytelny a nowe zadanie przetrwa restart`() {
        val old = WertisJson.decodeFromString<WmsJournal>("{}")
        assertNull(old.replenishing)
        val journal = old.copy(replenishing = WmsActiveReplenishment(replenisher, 1))
        assertEquals(journal, WertisJson.decodeFromString<WmsJournal>(WertisJson.encodeToString(WmsJournal.serializer(), journal)))
    }
}

private class ReplenishStore : WmsStore {
    var journal = WmsJournal(active = WmsActive(replenisher, 5))
    var reject: (WmsJournal) -> Boolean = { false }
    override suspend fun read() = journal
    override suspend fun write(journal: WmsJournal) { if (reject(journal)) throw IOException("Dysk"); this.journal = journal }
}
private class ReplenishClient(val store: ReplenishStore) : WmsReplenishmentTransport {
    var task = replenishTask
    var failure: Exception? = null
    var lost = false
    var invalidId = false
    var getFailure = false
    val sent = mutableListOf<WmsPending>()
    val commits = mutableSetOf<String>()
    override suspend fun queue(view: String, query: String, offset: Int) = WmsReplenishmentQueue(view,
        if (view == "plans") listOf(replenishPlan) else emptyList(), if (view == "tasks") listOf(task) else emptyList(), 1)
    override suspend fun replenishingTask(id: Long): WmsReplenishmentTask {
        if (getFailure) throw IOException("Odczyt")
        return task
    }
    override suspend fun send(command: WmsPending): Long {
        assertEquals(command, store.journal.pending); sent += command
        failure?.let { throw it }
        if (commits.add(command.key)) {
            if (command.path.endsWith("/complete")) {
                val placed = command.body["quantity"]!!.jsonPrimitive.content.toInt()
                val picked = command.body["pickedQuantity"]?.jsonPrimitive?.content?.toInt() ?: placed
                task = task.copy(completed_at = "done", moved = placed, returned_quantity = picked - placed,
                    target_full = if (command.body["targetFull"]?.jsonPrimitive?.content == "true") 1 else 0)
            }
            if (command.path.endsWith("/cancel")) task = task.copy(cancelled_at = "done")
        }
        if (lost) throw IOException("Utracona odpowiedź")
        return if (invalidId) 0 else task.id
    }
}
class WmsReplenishmentRecoveryTest {
    @Test fun `utracone potwierdzenie zwrotu zachowuje ilosci i nie wymaga ponownego ruchu`() = runTest {
        val store = ReplenishStore(); val client = ReplenishClient(store); val controller = WmsReplenishmentController(store, { client })
        controller.select(replenisher, 1)
        var scan = replenishmentSpaceStart(replenishTask, 2, WmsReplenishmentScan(true, "005901", 4))
        scan = replenishmentSpaceQuantity(replenishTask, 2, scan, "2", "Cel pełny")
        scan = replenishmentSpaceTarget(replenishTask, 2, scan, "A-01")
        client.lost = true; controller.submit(replenisher, replenishmentSpaceFinish(replenishTask, 2, scan, "RES-01"))
        val pending = store.journal.pending!!
        client.lost = false; val restart = WmsReplenishmentController(store, { client }); restart.open(replenisher); restart.retry(replenisher)
        assertEquals(pending, client.sent.last()); assertEquals(1, client.commits.size)
        assertEquals(2, restart.state.value.task!!.returned_quantity); assertEquals(2, restart.state.value.task!!.moved)
        assertEquals(1, restart.state.value.task!!.target_full); assertNull(store.journal.pending)
    }
    @Test fun `utracone podjecie po restarcie odzyskuje numer tym samym kluczem`() = runTest {
        val store = ReplenishStore(); val client = ReplenishClient(store); val controller = WmsReplenishmentController(store, { client })
        controller.queue(replenisher, "plans"); client.lost = true; controller.submit(replenisher, replenishmentClaim(replenishPlan))
        val pending = store.journal.pending!!
        assertNull(pending.taskId); assertEquals("replenishment", pending.workflow)
        assertEquals(WmsActive(replenisher, 5), store.journal.active)
        val restart = WmsReplenishmentController(store, { client }); restart.open(replenisher)
        assertFalse(restart.state.value.ready); client.lost = false; restart.retry(replenisher)
        assertEquals(pending, client.sent.last()); assertEquals(1, client.commits.size)
        assertNull(store.journal.pending); assertEquals(1L, store.journal.replenishing!!.taskId)
        assertEquals(WmsReplenishmentStage.SOURCE, replenishmentStage(restart.state.value.task!!, 2, WmsReplenishmentScan()))
    }
    @Test fun `utracone zakonczenie i anulowanie nie wykonuja drugiego zapisu`() = runTest {
        for (draft in listOf(replenishCommand(), replenishmentCancel(replenishTask, 2, "RES-01", "Zwrot na źródło"))) {
            val store = ReplenishStore(); val client = ReplenishClient(store); val controller = WmsReplenishmentController(store, { client })
            controller.select(replenisher, 1); client.lost = true; controller.submit(replenisher, draft)
            val pending = store.journal.pending!!; client.lost = false
            val restart = WmsReplenishmentController(store, { client }); restart.open(replenisher); restart.retry(replenisher)
            assertEquals(pending, client.sent.last()); assertEquals(1, client.commits.size); assertNull(store.journal.pending)
            assertEquals(WmsReplenishmentStage.DONE, replenishmentStage(restart.state.value.task!!, 2, WmsReplenishmentScan()))
        }
    }
    @Test fun `brak numeru w odpowiedzi zachowuje zamiar zamiast ponownego podjecia`() = runTest {
        val store = ReplenishStore(); val client = ReplenishClient(store); val controller = WmsReplenishmentController(store, { client })
        controller.queue(replenisher, "plans"); client.invalidId = true; controller.submit(replenisher, replenishmentClaim(replenishPlan))
        val pending = store.journal.pending!!; assertFalse(controller.state.value.ready)
        client.invalidId = false; controller.retry(replenisher)
        assertEquals(pending, client.sent.last()); assertEquals(1, client.commits.size); assertNull(store.journal.pending)
    }
    @Test fun `odrzucone podjecie odswieza propozycje a odrzucone zakonczenie wymaga nowych skanow`() = runTest {
        val store = ReplenishStore(); val client = ReplenishClient(store); val controller = WmsReplenishmentController(store, { client })
        controller.queue(replenisher, "plans"); client.failure = ApiError(409, "Stan zmienił się")
        controller.submit(replenisher, replenishmentClaim(replenishPlan))
        assertNull(store.journal.pending); assertNull(store.journal.replenishing); assertEquals("plans", controller.state.value.queue!!.view)
        controller.select(replenisher, 1); val generation = controller.state.value.generation
        client.task = replenishTask.copy(blocked = "Przelicz źródło"); controller.submit(replenisher, replenishCommand())
        assertNull(store.journal.pending); assertTrue(controller.state.value.generation > generation)
        assertEquals("Przelicz źródło", controller.state.value.task!!.blocked)
    }
    @Test fun `awaria dysku przed wyslaniem i po potwierdzeniu zachowuje jednoznacznosc`() = runTest {
        val store = ReplenishStore(); val client = ReplenishClient(store); val controller = WmsReplenishmentController(store, { client })
        controller.queue(replenisher, "plans"); store.reject = { it.pending != null }; controller.submit(replenisher, replenishmentClaim(replenishPlan))
        assertTrue(client.sent.isEmpty()); store.reject = { false }; controller.queue(replenisher, "plans")
        store.reject = { it.pending == null }; controller.submit(replenisher, replenishmentClaim(replenishPlan))
        assertNotNull(store.journal.pending); store.reject = { false }; controller.retry(replenisher)
        assertNull(store.journal.pending); assertEquals(1, client.commits.size)
    }
    @Test fun `inny serwer konto lub proces nie ponawiaja niepewnego przesuniecia`() = runTest {
        val store = ReplenishStore(); val client = ReplenishClient(store); val controller = WmsReplenishmentController(store, { client })
        controller.select(replenisher, 1); client.lost = true; controller.submit(replenisher, replenishCommand())
        for (context in listOf(replenisher.copy(actorId = 3), replenisher.copy(server = "http://other/"))) {
            controller.open(context); controller.retry(context); controller.queue(context, "plans"); assertFalse(controller.state.value.ready)
        }
        assertEquals(1, client.sent.size)
        store.journal = store.journal.copy(pending = store.journal.pending!!.copy(workflow = "counting"))
        controller.open(replenisher); controller.retry(replenisher); assertEquals(1, client.sent.size)
    }
    @Test fun `odczyt po zapisie musi sie udac przed dalszymi skanami`() = runTest {
        val store = ReplenishStore(); val client = ReplenishClient(store); val controller = WmsReplenishmentController(store, { client })
        controller.queue(replenisher, "plans"); client.getFailure = true; controller.submit(replenisher, replenishmentClaim(replenishPlan))
        assertNull(store.journal.pending); assertEquals(1L, store.journal.replenishing!!.taskId); assertFalse(controller.state.value.ready)
        controller.submit(replenisher, replenishmentClaim(replenishPlan)); assertEquals(1, client.sent.size)
        client.getFailure = false; controller.open(replenisher); assertTrue(controller.state.value.ready)
    }
}
