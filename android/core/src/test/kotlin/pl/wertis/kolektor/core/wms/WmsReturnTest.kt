package pl.wertis.kolektor.core.wms

import java.io.IOException
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.*
import org.junit.Test
import pl.wertis.kolektor.core.net.WertisJson
import pl.wertis.kolektor.core.scan.classify

private val returnActor = WmsContext("http://seeded/", 2)
private val returnPart = WmsReturnTask(7, 12, 4, 30, "LOC:PART", "Koło", "0590123", "A-01", "BOX-1", 1, 2, "Rezygnacja klienta")
private val returnRun = WmsRun(5, "CART-20", 2, orders = listOf(WmsOrder(12, "picked", "Rezygnacja klienta")), tasks = emptyList(), returns = listOf(returnPart))
private fun returnDraft() = returnScan(returnRun, returnPart, 2, WmsReturnScan(true, returnPart.sku, 1, alternative = true), "B-01").command!!

class WmsReturnTest {
    @Test fun `inna polka wymaga wyboru a kwarantanna nie jest celem dobrego zwrotu`() {
        val scan = WmsReturnScan(true, returnPart.sku, 1)
        assertThrows(IllegalArgumentException::class.java) { returnScan(returnRun, returnPart, 2, scan, "B-01") }
        val command = returnScan(returnRun, returnPart, 2, scan.copy(alternative = true), "b-01").command!!
        assertEquals("A-01", command.body["bin"]!!.jsonPrimitive.content)
        assertEquals("B-01", command.body["target"]!!.jsonPrimitive.content)
        val quarantined = returnPart.copy(source_mode = "quarantine")
        val run = returnRun.copy(returns = listOf(quarantined))
        assertThrows(IllegalArgumentException::class.java) { returnScan(run, quarantined, 2, scan, "A-01") }
        assertNotNull(returnScan(run, quarantined, 2, scan, "B-01").command)
        assertThrows(IllegalArgumentException::class.java) { returnScan(run, quarantined, 2, scan, "BAD/BIN") }
    }
    @Test fun `skrzynka czesc jawna ilosc i polka tworza pojedynczy zwrot`() {
        var scan = WmsReturnScan()
        assertThrows(IllegalArgumentException::class.java) { returnScan(returnRun, returnPart, 2, scan, "BOX-2") }
        scan = returnScan(returnRun, returnPart, 2, scan, "BOX-1").state
        assertThrows(IllegalArgumentException::class.java) { returnScan(returnRun, returnPart, 2, scan, "590123") }
        scan = returnScan(returnRun, returnPart, 2, scan, "0590123").state
        assertThrows(IllegalArgumentException::class.java) { returnScan(returnRun, returnPart, 2, scan, "A-01") }
        scan = returnQuantity(returnPart, scan, "1")
        assertThrows(IllegalArgumentException::class.java) { returnScan(returnRun, returnPart, 2, scan, "B-01") }
        val command = returnScan(returnRun, returnPart, 2, scan, "A-01").command!!
        assertEquals(5L, command.runId)
        assertEquals("api/wms/orders/12/actions", command.path)
        assertEquals("BOX-1", command.body["tote"]!!.jsonPrimitive.content)
        assertEquals("1", command.body["quantity"]!!.jsonPrimitive.content)
        assertEquals("return", command.body["action"]!!.jsonPrimitive.content)
        assertEquals("5", command.body["runId"]!!.jsonPrimitive.content)
    }
    @Test fun `puste i nadmierne liczenie nie potwierdzaja zwrotu`() {
        for (raw in listOf("", "0", "-1", "1.5", "3", "10000000", "999999999999999")) {
            assertThrows(IllegalArgumentException::class.java) { returnQuantity(returnPart, WmsReturnScan(true, returnPart.sku), raw) }
        }
        assertThrows(IllegalArgumentException::class.java) { returnQuantity(returnPart, WmsReturnScan(), "1") }
        assertEquals("LOC:PART", returnCode(WmsReturnScan(true), classify("LOC:PART")))
        assertEquals("A-01", returnCode(WmsReturnScan(true, returnPart.sku, 1), classify("LOC:A-01")))
    }
    @Test fun `inna trasa przekazanie lub usuniety zwrot nie przyjmuja skanu`() {
        for (run in listOf(returnRun.copy(picker_id = 3), returnRun.copy(arrived_at = "teraz"), returnRun.copy(closed_at = "teraz"), returnRun.copy(returns = emptyList()))) {
            assertThrows(IllegalArgumentException::class.java) { returnScan(run, returnPart, 2, WmsReturnScan(true, returnPart.sku, 1), "A-01") }
        }
        val old = WertisJson.decodeFromString<WmsRun>("""{"id":5,"cart_code":"CART-20","picker_id":2,"orders":[],"tasks":[]}""")
        assertTrue(old.returns.isEmpty())
    }
    @Test fun `utracony zwrot korzysta z dziennika zbiorki i tego samego klucza po restarcie`() = runTest {
        var journal = WmsJournal(active = WmsActive(returnActor, 5))
        val store = object : WmsStore {
            override suspend fun read() = journal
            override suspend fun write(value: WmsJournal) { journal = value }
        }
        var current = returnRun
        val committed = mutableSetOf<String>()
        var lost = true
        val sent = mutableListOf<WmsPending>()
        val client = object : WmsTransport {
            override suspend fun run(id: Long) = current
            override suspend fun send(command: WmsPending): Long {
                assertEquals(command, journal.pending); sent += command
                if (committed.add(command.key)) current = returnRun.copy(returns = listOf(returnPart.copy(remaining = 1, version = 5)))
                if (lost) throw IOException("Utracona odpowiedź")
                return 5
            }
        }
        val first = WmsController(store, { client }); first.open(returnActor); first.submit(returnActor, returnDraft())
        val pending = journal.pending!!
        assertEquals("B-01", pending.body["target"]!!.jsonPrimitive.content)
        assertEquals("picking", pending.workflow)
        val restart = WmsController(store, { client }); restart.open(returnActor)
        assertFalse(restart.state.value.ready)
        lost = false; restart.retry(returnActor)
        assertEquals(pending, sent.last()); assertEquals(1, committed.size)
        assertNull(journal.pending); assertNull(restart.state.value.initialScan)
        assertEquals(1, restart.state.value.run!!.returns.single().remaining)
        assertEquals(WmsReturnStage.BOX, returnStage(WmsReturnScan()))
    }
}
