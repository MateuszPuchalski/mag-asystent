package pl.wertis.kolektor.core.net

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DtosTest {

    @Test fun `ScanResult - product`() {
        val json = """
            {"type":"product","card":{"id":7,"sym":"AB-1","name":"Łańcuch","ean":"5901234123457",
             "unit":"szt","ordered":0,"desc":"","locs":["E08-03-01"],
             "mag":{"stan":10,"rez":2,"avail":8,"pendingIn":0,"pendingOut":1,"effective":9},
             "mgp":{"stan":0,"rez":0,"avail":0,"pendingIn":0,"pendingOut":0,"effective":0}}}
        """.trimIndent()
        val r = WertisJson.decodeFromString<ScanResult>(json)
        assertTrue(r is ScanResult.Product)
        val card = (r as ScanResult.Product).card
        assertEquals("AB-1", card.sym)
        assertEquals(9.0, card.mag.effective, 0.0)
        assertNull(card.zwroty)
    }

    @Test fun `ScanResult - search i notfound`() {
        val s = WertisJson.decodeFromString<ScanResult>(
            """{"type":"search","results":[{"id":1,"sym":"S","name":"N","ean":"","mag":1,"mgp":0,"locs":[]}]}"""
        )
        assertTrue(s is ScanResult.Search)
        assertEquals(1, (s as ScanResult.Search).results.size)

        val n = WertisJson.decodeFromString<ScanResult>("""{"type":"notfound","code":"XYZ"}""")
        assertEquals("XYZ", (n as ScanResult.NotFound).code)
    }

    @Test fun `QueueResponse - statusy i summary`() {
        val json = """
            {"items":[
              {"id":1,"type":"set_location","status":"waiting_for_doc","label":"L","detail":"D","errMsg":null,"time":"12:00"},
              {"id":2,"type":"mm","status":"error","label":"L2","detail":"","errMsg":"Błąd Sfery","time":"12:01"},
              {"id":3,"type":"combo","status":"done","label":"L3","detail":"","errMsg":null,"time":"12:02"}
             ],"summary":{"pending":1,"error":1,"done":1}}
        """.trimIndent()
        val r = WertisJson.decodeFromString<QueueResponse>(json)
        assertEquals(QueueStatus.WAITING_FOR_DOC, r.items[0].status)
        assertEquals(QueueItemType.COMBO, r.items[2].type)
        assertEquals("Błąd Sfery", r.items[1].errMsg)
        assertEquals(1, r.summary.error)
    }

    @Test fun `PutawaySession - pelny kszalt`() {
        val json = """
            {"id":5,"sourceDocId":11,"sourceDocNumber":"FZ 1/2026","zone":"zwroty","status":"open",
             "progress":{"total":10,"done":3,"remaining":7,"onCart":2},
             "queueAlerts":[{"id":9,"type":"mm","label":"MM","detail":"x","errorMsg":"e"}],
             "inFlight":1,
             "items":[{"id":1,"twId":7,"sym":"S","name":"N","targetLoc":null,"qtyExpected":4,
                       "qtyDone":0,"delta":0,"mgpStan":4,"status":"on_cart","skipReason":null,
                       "lockedBy":"anna","offDocument":false,"stageQty":2.5,"stageLoc":"E01-01-01"}]}
        """.trimIndent()
        val s = WertisJson.decodeFromString<PutawaySession>(json)
        assertEquals(PutawayZone.ZWROTY, s.zone)
        assertEquals(PutawayItemStatus.ON_CART, s.items[0].status)
        assertEquals(2.5, s.items[0].stageQty!!, 0.0)
        assertNull(s.items[0].targetLoc)
        assertEquals("anna", s.items[0].lockedBy)
    }

    @Test fun `nieznane pola sa ignorowane`() {
        val r = WertisJson.decodeFromString<QueueIdResponse>("""{"queueId":42,"kind":"mm","extra":true}""")
        assertEquals(42L, r.queueId)
    }

    @Test fun `serializacja cial zadan pomija nulle`() {
        val body = WertisJson.encodeToString(SetLocationBody.serializer(), SetLocationBody(LocAction.REPLACE, value = "E08-03-01"))
        assertTrue(body.contains("\"replace\""))
        assertTrue(!body.contains("replaced"))
    }

    @Test fun `PutawayDocument z sesja i bez`() {
        val d1 = WertisJson.decodeFromString<PutawayDocument>(
            """{"docId":1,"typ":"FZ","nrPelny":"FZ 1","dataWyst":"2026-07-01","dostawca":"X","positions":3,"zone":"mgp",
                "session":{"id":2,"status":"open","progressPct":50}}"""
        )
        assertEquals(50.0, d1.session!!.progressPct, 0.0)
        val d2 = WertisJson.decodeFromString<PutawayDocument>(
            """{"docId":2,"typ":"PZ","nrPelny":"PZ 9","dataWyst":"","dostawca":"","positions":1,"zone":"mgp"}"""
        )
        assertNull(d2.session)
        assertEquals(false, d2.onMag) // domyślnie false, gdy pole nieobecne

        // dostawa już przeniesiona na MAG (biuro zrobiło MM) — do zlokalizowania
        val d3 = WertisJson.decodeFromString<PutawayDocument>(
            """{"docId":3,"typ":"PZ","nrPelny":"PZ 12","positions":2,"zone":"mgp","onMag":true}"""
        )
        assertEquals(true, d3.onMag)
    }
}
