package pl.wertis.kolektor.core.wms

import java.io.IOException
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.*
import org.junit.Test
import pl.wertis.kolektor.core.net.WertisJson

private val putbackActor=WmsContext("http://seeded/",4)
private val putbackPart=WmsReturnTask(1,2,3,30,"LOC:PART","Część",bin="A-01",tote="BOX",position=0,remaining=2,hold_reason="Anulowanie")
private val putbackFixture=WmsPutbackTask(1,2,"ORDER","BOX","PACK","Anulowanie",1,3,picks=listOf(putbackPart))
private class PutbackStore:WmsStore {
    var journal=WmsJournal();var failWrite=false
    override suspend fun read()=journal
    override suspend fun write(journal:WmsJournal){if(failWrite)throw IOException("disk");this.journal=journal}
}
private class PutbackClient(val store:PutbackStore):WmsPutbackTransport {
    var task=putbackFixture;var lost=false;val sent=mutableListOf<WmsPending>();val committed=mutableSetOf<String>()
    override suspend fun queue(query:String,offset:Int)=WmsPutbackQueue(emptyList(),0)
    override suspend fun putbackTask(id:Long)=task
    override suspend fun send(command:WmsPending):Long {
        assertEquals(command,store.journal.pending);sent+=command
        if(committed.add(command.key))task=if(command.path.endsWith("/claim"))task.copy(user_id=4,version=2,order_version=4,picks=listOf(putbackPart.copy(version=4)))
            else task.copy(version=task.version+1,order_version=task.order_version+1,picks=listOf(task.picks[0].copy(remaining=1)))
        if(lost)throw IOException("lost response")
        return task.id
    }
}
class WmsPutbackTest {
    @Test fun `odbior i zwolnienie wymagaja fizycznego stanowiska oraz skrzynki`() {
        assertThrows(IllegalArgumentException::class.java){putbackClaim(putbackFixture,"EX","BOX")}
        assertThrows(IllegalArgumentException::class.java){putbackClaim(putbackFixture,"PACK","LOC:BOX")}
        assertEquals("true",putbackClaim(putbackFixture,"PACK","BOX").body["contentsConfirmed"]!!.jsonPrimitive.content)
        val owned=putbackFixture.copy(user_id=4)
        assertThrows(IllegalArgumentException::class.java){putbackRelease(owned,3,"PACK","BOX","Zmiana")}
        assertThrows(IllegalArgumentException::class.java){putbackRelease(owned,4,"EX","BOX","Zmiana")}
        assertEquals("PACK",putbackRelease(owned,4,"PACK","BOX","Zmiana").body["station"]!!.jsonPrimitive.content)
        assertNull(WertisJson.decodeFromString<WmsJournal>("{}").putback)
    }
    @Test fun `czesc i jawna ilosc wracaja na dopuszczona polke bez prefiksu SKU`() {
        val t=putbackFixture.copy(user_id=4);var scan=WmsReturnScan()
        assertThrows(IllegalArgumentException::class.java){putbackScan(t,3,putbackPart,scan,"BOX")}
        scan=putbackScan(t,4,putbackPart,scan,"BOX").first
        assertThrows(IllegalArgumentException::class.java){putbackScan(t,4,putbackPart,scan,"PART")}
        scan=putbackScan(t,4,putbackPart,scan,"LOC:PART").first
        assertThrows(IllegalArgumentException::class.java){returnQuantity(putbackPart,scan,"")}
        scan=returnQuantity(putbackPart,scan,"1")
        assertThrows(IllegalArgumentException::class.java){putbackScan(t,4,putbackPart,scan,"B-01")}
        val result=putbackScan(t,4,putbackPart,scan.copy(alternative=true),"B-01").second!!
        assertEquals("LOC:PART",result.body["barcode"]!!.jsonPrimitive.content)
        assertEquals("B-01",result.body["target"]!!.jsonPrimitive.content)
        assertEquals("3",result.body["orderVersion"]!!.jsonPrimitive.content)
    }
    @Test fun `dziennik odzyskuje odbior i jedna partie po restarcie bez zapamietanego skanu skrzynki`()=runTest {
        val store=PutbackStore();val client=PutbackClient(store);var c=WmsPutbackController(store,{client})
        c.select(putbackActor,1);store.failWrite=true;c.submit(putbackActor,putbackClaim(putbackFixture,"PACK","BOX"));assertTrue(client.sent.isEmpty())
        store.failWrite=false;c.select(putbackActor,1);client.lost=true;c.submit(putbackActor,putbackClaim(putbackFixture,"PACK","BOX"))
        val first=store.journal.pending!!;assertFalse(c.state.value.ready)
        c=WmsPutbackController(store,{client});c.open(putbackActor);client.lost=false;c.retry(putbackActor)
        assertNull(store.journal.pending);assertNull(c.state.value.confirmedBox);assertEquals(first.key,client.sent.last().key);assertEquals(1,client.committed.size)
        val task=c.state.value.task!!;val part=task.picks.first()
        val draft=putbackScan(task,4,part,WmsReturnScan(true,"LOC:PART",1),"A-01").second!!
        client.lost=true;c.submit(putbackActor,draft);val pending=store.journal.pending!!
        c=WmsPutbackController(store,{client});c.open(putbackActor);client.lost=false;c.retry(putbackActor)
        assertEquals(pending.key,client.sent.last().key);assertEquals(2,client.committed.size);assertEquals(1,c.state.value.task!!.picks[0].remaining);assertNull(c.state.value.confirmedBox)
        c.submit(putbackActor,putbackScan(c.state.value.task!!,4,c.state.value.task!!.picks[0],WmsReturnScan(true,"LOC:PART",1),"A-01").second!!)
        assertEquals("BOX",c.state.value.confirmedBox)
        c.open(putbackActor);assertNull(c.state.value.confirmedBox)
    }
}
