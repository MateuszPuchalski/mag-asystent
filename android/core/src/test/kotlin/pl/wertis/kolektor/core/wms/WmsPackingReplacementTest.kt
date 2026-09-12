package pl.wertis.kolektor.core.wms

import java.io.IOException
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.*
import org.junit.Test
import pl.wertis.kolektor.core.net.WertisJson
import pl.wertis.kolektor.core.scan.classify

private val recoveryActor=WmsContext("http://seeded/",2)
private val replacement=WmsRecoveryPick(1,30,"LOC:PART","Część","005901","A-01",2,3)
private val replacementTask=WmsRecoveryTask(1,1,2,1,"ORDER",box="BOX-01",lines=listOf(WmsRecoveryLine(1,"LOC:PART",2,0,"QUAR")),picks=listOf(replacement))
private fun replacementDraft()=recoveryFinish(replacementTask,2,WmsRecoveryScan(1,true,"LOC:PART",2),classify("LOC:BOX-01"))
private class RecoveryStore:WmsStore {
    var journal=WmsJournal()
    var reject:(WmsJournal)->Boolean={false}
    override suspend fun read()=journal
    override suspend fun write(journal:WmsJournal){if(reject(journal))throw IOException("disk");this.journal=journal}
}
private class RecoveryClient(val store:RecoveryStore):WmsRecoveryTransport {
    var task=replacementTask
    var lost=false
    var getFailure=false
    val sent=mutableListOf<WmsPending>()
    val commits=mutableSetOf<String>()
    override suspend fun queue(query:String,offset:Int)=WmsRecoveryQueue(emptyList(),0)
    override suspend fun recoveringTask(id:Long):WmsRecoveryTask { if(getFailure)throw IOException("GET");return task }
    override suspend fun send(command:WmsPending):Long {
        assertEquals(command,store.journal.pending);sent+=command
        if(commits.add(command.key))task=when {
            command.path.endsWith("/claim")->replacementTask.copy(version=task.version+1)
            command.path.endsWith("/pick")->task.copy(version=task.version+1,completed_at="done",picks=emptyList(),lines=task.lines.map{it.copy(replaced=it.quantity)})
            else->task.copy(version=task.version+1,user_id=null,picks=emptyList())
        }
        if(lost)throw IOException("Wi-Fi")
        return task.id
    }
}
class WmsPackingReplacementTest {
    @Test fun `skany wymagaja zrodla czesci jawnej ilosci i wlasciwej skrzynki`() {
        var scan=WmsRecoveryScan()
        assertThrows(IllegalArgumentException::class.java){recoveryScan(replacementTask,2,scan,classify("BAD"))}
        scan=recoveryScan(replacementTask,2,scan,classify("LOC:A-01"))
        assertThrows(IllegalArgumentException::class.java){recoveryScan(replacementTask,2,scan,classify("PART"))}
        scan=recoveryScan(replacementTask,2,scan,classify("LOC:PART"))
        for(raw in listOf("","0","-1","3","1.5"))assertThrows(IllegalArgumentException::class.java){recoveryQuantity(replacementTask,2,scan,raw)}
        scan=recoveryQuantity(replacementTask,2,scan,"1")
        assertThrows(IllegalArgumentException::class.java){recoveryFinish(replacementTask,2,scan,classify("BOX-02"))}
        val draft=recoveryFinish(replacementTask,2,scan,classify("LOC:BOX-01"))
        assertEquals("LOC:PART",draft.body["barcode"]!!.jsonPrimitive.content)
        assertEquals("1",draft.body["quantity"]!!.jsonPrimitive.content)
        assertEquals(WmsRecoveryStage.OTHER,recoveryStage(replacementTask,3,scan))
        assertEquals(WmsRecoveryStage.BLOCKED,recoveryStage(replacementTask.copy(hold_reason="Hold"),2,scan))
        assertNull(recoveryPick(replacementTask,WmsRecoveryScan(allocationId=99)))
        assertNull(WertisJson.decodeFromString<WmsJournal>("{}").recovering)
    }
    @Test fun `zwolnienie wymaga wszystkich zrodel po zwrocie niepotwierdzonych sztuk`() {
        val task=replacementTask.copy(picks=listOf(replacement,replacement.copy(allocation_id=2,bin="B-01")))
        assertThrows(IllegalArgumentException::class.java){recoveryRelease(task,2,setOf("A-01"),"Zwrot")}
        assertThrows(IllegalArgumentException::class.java){recoveryRelease(task,2,setOf("A-01","B-01"),"")}
        assertThrows(IllegalArgumentException::class.java){recoveryRelease(task,3,setOf("A-01","B-01"),"Zwrot")}
        assertEquals("[\"A-01\",\"B-01\"]",recoveryRelease(task,2,setOf("B-01","A-01"),"Zwrot").body["sources"].toString())
    }
    @Test fun `restart odzyskuje podjecie i dostarczenie bez ponownego ruchu`()=runTest {
        val store=RecoveryStore();val client=RecoveryClient(store);client.task=replacementTask.copy(user_id=null,picks=emptyList())
        var controller=WmsRecoveryController(store,{client});controller.select(recoveryActor,1)
        client.lost=true;controller.submit(recoveryActor,recoveryClaim(client.task,2));assertNotNull(store.journal.pending)
        val first=store.journal.pending;controller=WmsRecoveryController(store,{client});controller.open(recoveryActor);assertFalse(controller.state.value.ready)
        client.lost=false;controller.retry(recoveryActor);assertNull(store.journal.pending);assertEquals(first!!.key,client.sent.last().key)
        client.task=replacementTask;controller.select(recoveryActor,1);client.lost=true;controller.submit(recoveryActor,replacementDraft())
        val pending=store.journal.pending!!;assertEquals("pack-recovery",pending.workflow)
        controller=WmsRecoveryController(store,{client});controller.open(recoveryActor);client.lost=false;controller.retry(recoveryActor)
        assertNull(store.journal.pending);assertNotNull(controller.state.value.task!!.completed_at);assertEquals(pending,client.sent.last());assertEquals(2,client.commits.size)
    }
    @Test fun `awaria dysku i odczytu nie pozwala wyslac kolejnego pobrania`()=runTest {
        val store=RecoveryStore();val client=RecoveryClient(store);val controller=WmsRecoveryController(store,{client});controller.select(recoveryActor,1)
        store.reject={it.pending!=null};controller.submit(recoveryActor,replacementDraft());assertTrue(client.sent.isEmpty())
        store.reject={false};controller.open(recoveryActor);store.reject={it.pending==null};controller.submit(recoveryActor,replacementDraft());assertNotNull(store.journal.pending)
        store.reject={false};client.getFailure=true;controller.retry(recoveryActor);assertNull(store.journal.pending);assertFalse(controller.state.value.ready)
        controller.submit(recoveryActor,replacementDraft());assertEquals(1,client.commits.size)
        client.getFailure=false;controller.open(recoveryActor);assertTrue(controller.state.value.ready)
    }
    @Test fun `inne konto serwer lub proces nie przejmuja nierozliczonej wymiany`()=runTest {
        val store=RecoveryStore();val client=RecoveryClient(store);val controller=WmsRecoveryController(store,{client});controller.select(recoveryActor,1)
        client.lost=true;controller.submit(recoveryActor,replacementDraft())
        for(context in listOf(recoveryActor.copy(actorId=3),recoveryActor.copy(server="http://other/"))){controller.open(context);controller.retry(context);assertFalse(controller.state.value.ready)}
        store.journal=store.journal.copy(pending=store.journal.pending!!.copy(workflow="picking"));controller.open(recoveryActor);controller.retry(recoveryActor)
        assertEquals(1,client.sent.size)
    }
}
