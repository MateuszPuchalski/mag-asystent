package pl.wertis.kolektor.core.wms

import java.io.IOException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.buildJsonObject
import org.junit.Assert.*
import org.junit.Test

private val lifecycleActor = WmsContext("http://seeded/", 2)
private class LifecycleStore : WmsStore {
    var journal = WmsJournal(active = WmsActive(lifecycleActor, 1), putaway = WmsActivePutaway(lifecycleActor, 1),
        receiving = WmsActiveInbound(lifecycleActor, 1), counting = WmsActiveCount(lifecycleActor, 1))
    var beforeRead: suspend () -> Unit = {}
    var beforeWrite: suspend (WmsJournal) -> Unit = {}
    override suspend fun read(): WmsJournal { beforeRead(); return journal }
    override suspend fun write(journal: WmsJournal) { beforeWrite(journal); this.journal = journal }
}
private class LifecycleHarness(val workflow: String) {
    val store = LifecycleStore()
    val lock = Mutex()
    var beforeGet: suspend () -> Unit = {}
    var beforeSend: suspend () -> Unit = {}
    var sends = 0
    var gets = 0
    var lost = false
    val commits = mutableSetOf<String>()
    lateinit var open: suspend () -> Unit
    lateinit var submit: suspend () -> Unit
    lateinit var retry: suspend () -> Unit
    lateinit var pause: () -> Unit
    var activate: () -> Unit = {}
    lateinit var ready: () -> Boolean
    init {
        val body = buildJsonObject {}
        suspend fun get() { gets++; beforeGet() }
        suspend fun transmit(pending: WmsPending) {
            assertEquals(pending, store.journal.pending)
            sends++; beforeSend(); commits.add(pending.key)
            if (lost) throw IOException("Wi-Fi")
        }
        when (workflow) {
            "picking" -> {
                val controller = WmsController(store, { object : WmsTransport {
                    override suspend fun run(id: Long): WmsRun { get(); return WmsRun(1, "CART-20", 2, orders = emptyList(), tasks = emptyList()) }
                    override suspend fun send(command: WmsPending): Long { transmit(command); return 1 }
                } }, lock = lock)
                open = { controller.open(lifecycleActor) }; pause = controller::invalidateVerification
                activate = controller::activateVerification
                submit = { controller.submit(lifecycleActor, WmsDraft("api/wms/test", body, "Zbiórka", 1)) }
                retry = { controller.retry(lifecycleActor) }; ready = { controller.state.value.ready }
            }
            "putaway" -> {
                val controller = WmsPutawayController(store, { object : WmsPutawayTransport {
                    override suspend fun queue(query: String, offset: Int): WmsPutawayQueue = error("Unexpected queue")
                    override suspend fun putawayTask(id: Long): WmsPutawayTask {
                        get(); return WmsPutawayTask(1, 30, "BUF-01", 12, 12, 2, 1, "SKU", "Część", reference = "PZ")
                    }
                    override suspend fun send(command: WmsPending) = transmit(command)
                } }, lock = lock)
                open = { controller.open(lifecycleActor) }; pause = controller::invalidateVerification
                activate = controller::activateVerification
                submit = { controller.submit(lifecycleActor, WmsPutawayDraft(1, "api/wms/test", body, "Odłożenie")) }
                retry = { controller.retry(lifecycleActor) }; ready = { controller.state.value.ready }
            }
            "receiving" -> {
                val controller = WmsInboundController(store, { object : WmsInboundTransport {
                    override suspend fun documents(query: String, offset: Int): WmsInboundList = error("Unexpected queue")
                    override suspend fun receiveDocument(id: Long, query: String, offset: Int, lineId: Long?, barcode: String?): WmsInboundDocument {
                        get(); return WmsInboundDocument(WmsInboundHeader(1, "PZ", "Dostawca", 1), WmsInboundSummary(0, 0, 0, 0, 0), emptyList(), 0)
                    }
                    override suspend fun send(command: WmsPending) = transmit(command)
                } }, lock = lock)
                open = { controller.open(lifecycleActor) }; pause = controller::invalidateVerification
                activate = controller::activateVerification
                submit = { controller.submit(lifecycleActor, WmsInboundDraft(1, null, "api/wms/test", body, "Przyjęcie")) }
                retry = { controller.retry(lifecycleActor) }; ready = { controller.state.value.ready }
            }
            else -> {
                val controller = WmsCountController(store, { object : WmsCountTransport {
                    override suspend fun queue(query: String, offset: Int): WmsCountQueue = error("Unexpected queue")
                    override suspend fun countingTask(id: Long): WmsCountTask {
                        get(); return WmsCountTask(1, 30, "A-01", "SKU", "Część", version = 1, reason = "Brak")
                    }
                    override suspend fun send(command: WmsPending) = transmit(command)
                } }, lock = lock)
                open = { controller.open(lifecycleActor) }; pause = controller::invalidateVerification
                activate = controller::activateVerification
                submit = { controller.submit(lifecycleActor, WmsCountDraft(1, "api/wms/test", body, "Liczenie")) }
                retry = { controller.retry(lifecycleActor) }; ready = { controller.state.value.ready }
            }
        }
    }
}

class WmsLifecycleTest {
    private val workflows = listOf("picking", "putaway", "receiving", "counting")
    @Test fun `uspienie blokuje zapis nawet przy gotowym ekranie`() = runTest {
        for (workflow in workflows) {
            val h = LifecycleHarness(workflow); h.open(); assertTrue(workflow, h.ready())
            h.pause(); assertFalse(workflow, h.ready()); h.submit(); assertEquals(workflow, 0, h.sends)
        }
    }
    @Test fun `spozniony odczyt nie wlacza komend po uspieniu`() = runTest {
        for (workflow in workflows) {
            val h = LifecycleHarness(workflow); val started = CompletableDeferred<Unit>(); val finish = CompletableDeferred<Unit>()
            h.beforeGet = { started.complete(Unit); finish.await() }
            val job = launch { h.open() }; started.await(); h.pause(); finish.complete(Unit); job.join()
            assertFalse(workflow, h.ready()); h.submit(); assertEquals(workflow, 0, h.sends)
        }
    }
    @Test fun `odczyt oczekujacy na wspolnej blokadzie nie wznawia uspionego ekranu`() = runTest {
        for (workflow in workflows) {
            val h = LifecycleHarness(workflow); h.lock.lock()
            val started = CompletableDeferred<Unit>(); val job = launch { started.complete(Unit); h.open() }
            started.await(); h.pause(); h.lock.unlock(); job.join()
            assertFalse(workflow, h.ready()); assertEquals(workflow, 0, h.gets)
        }
    }
    @Test fun `uspienie podczas odczytu dziennika zatrzymuje jeszcze niewyslany zamiar`() = runTest {
        for (workflow in workflows) {
            val h = LifecycleHarness(workflow); h.open()
            val started = CompletableDeferred<Unit>(); val finish = CompletableDeferred<Unit>()
            h.store.beforeRead = { started.complete(Unit); finish.await() }
            val job = launch { h.submit() }; started.await(); h.pause(); finish.complete(Unit); job.join()
            assertEquals(workflow, 0, h.sends); assertNull(workflow, h.store.journal.pending)
        }
    }
    @Test fun `juz wyslany zapis rozlicza sie po uspieniu ale nie odblokowuje ekranu`() = runTest {
        for (workflow in workflows) {
            val h = LifecycleHarness(workflow); h.open()
            val started = CompletableDeferred<Unit>(); val finish = CompletableDeferred<Unit>()
            h.beforeSend = { started.complete(Unit); finish.await() }
            val job = launch { h.submit() }; started.await(); h.pause(); finish.complete(Unit); job.join()
            assertEquals(workflow, 1, h.commits.size); assertNull(workflow, h.store.journal.pending); assertFalse(workflow, h.ready())
            h.activate(); h.open(); assertTrue(workflow, h.ready())
        }
    }
    @Test fun `ponowienie nie wychodzi z uspionego ekranu i zachowuje klucz`() = runTest {
        for (workflow in workflows) {
            val h = LifecycleHarness(workflow); h.open(); h.lost = true; h.submit()
            val pending = h.store.journal.pending; h.pause(); h.retry()
            assertEquals(workflow, 1, h.sends); assertEquals(workflow, pending, h.store.journal.pending)
            h.lost = false; h.activate(); h.open(); h.retry()
            assertNull(workflow, h.store.journal.pending); assertEquals(workflow, 1, h.commits.size)
        }
    }
    @Test fun `szybki powrot nie uznaje starej odpowiedzi za nowy odczyt`() = runTest {
        for (workflow in workflows) {
            val h = LifecycleHarness(workflow); val started = CompletableDeferred<Unit>(); val finish = CompletableDeferred<Unit>()
            h.beforeGet = { started.complete(Unit); finish.await() }
            val old = launch { h.open() }; started.await(); h.pause(); h.activate(); finish.complete(Unit); old.join()
            assertFalse(workflow, h.ready())
            h.beforeGet = {}; h.open(); assertTrue(workflow, h.ready())
        }
    }
    @Test fun `zamiar juz utrwalany na dysku przetrwa pauze i pozniejsza utrate odpowiedzi`() = runTest {
        for (workflow in workflows) {
            val h = LifecycleHarness(workflow); h.open()
            val started = CompletableDeferred<Unit>(); val finish = CompletableDeferred<Unit>()
            h.store.beforeWrite = { if (it.pending != null) { started.complete(Unit); finish.await() } }
            h.lost = true
            val job = launch { h.submit() }; started.await(); h.pause(); finish.complete(Unit); job.join()
            val pending = h.store.journal.pending
            assertNotNull(workflow, pending); assertFalse(workflow, h.ready()); assertEquals(workflow, 1, h.commits.size)
            h.lost = false; h.activate(); h.open(); h.retry()
            assertNull(workflow, h.store.journal.pending); assertEquals(workflow, 1, h.commits.size)
        }
    }
}
