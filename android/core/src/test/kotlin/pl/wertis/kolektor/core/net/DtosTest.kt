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

        // zwroty od klientów — druga strefa źródłowa trybu B
        val d3 = WertisJson.decodeFromString<PutawayDocument>(
            """{"docId":3,"typ":"ZW","nrPelny":"ZW 12","positions":2,"zone":"zwroty"}"""
        )
        assertEquals(PutawayZone.ZWROTY, d3.zone)
    }

    @Test fun `ScanResolution rozroznia kolizje EAN od linii`() {
        val line = WertisJson.decodeFromString<ScanResolution>(
            """{"kind":"line","line":{"id":7,"twId":401,"sym":"56-003","name":"Pilnik","qtyDoc":50,
                "qtyDone":0,"locExpected":"C03-01-03","status":"todo","aisle":"C"}}"""
        )
        assertEquals("56-003", (line as ScanResolution.Line).line.sym)

        // kod wskazujący 2 kartoteki musi dać conflict — nigdy „pierwsze dopasowanie"
        val c = WertisJson.decodeFromString<ScanResolution>(
            """{"kind":"conflict","code":"5905947596430","candidates":[
                {"twId":1,"sym":"W43-2002-1M","name":"sznurek 1 m","inDocument":true,"qtyDoc":200,"locExpected":"G14-03-03"},
                {"twId":2,"sym":"W43-2002","name":"sznurek 100 m","inDocument":false}]}"""
        )
        val conflict = c as ScanResolution.Conflict
        assertEquals(2, conflict.candidates.size)
        assertEquals(true, conflict.candidates[0].inDocument)

        val unknown = WertisJson.decodeFromString<ScanResolution>("""{"kind":"unknown","code":"123"}""")
        assertEquals("123", (unknown as ScanResolution.Unknown).code)
    }

    @Test fun `wyjatki - lista nierozwiazanych z kontekstem`() {
        val r = WertisJson.decodeFromString<ProblemsResponse>(
            """{"problems":[
                {"id":3,"deliveryId":1,"lineId":7,"typ":"damaged","qty":null,"opis":"zgnieciony karton",
                 "hasPhoto":true,"createdAt":"2026-07-25T10:00:00Z","createdBy":"anna",
                 "resolvedAt":null,"resolvedNote":null,
                 "docNumber":"FZ 120/07/2026","sym":"W04-0103","name":"Wąż"}]}"""
        )
        val p = r.problems.single()
        assertEquals("damaged", p.typ)
        assertEquals(true, p.hasPhoto)
        assertEquals("FZ 120/07/2026", p.docNumber)
        assertNull(p.resolvedAt)
    }

    @Test fun `putaway - locAction jest opcjonalne i serializuje sie kluczem protokolu`() {
        // ścieżka bez rozjazdu: pole w ogóle nie leci na serwer
        val plain = WertisJson.encodeToString(
            PutawayLineBody.serializer(), PutawayLineBody("E03-04-03")
        )
        assertTrue(!plain.contains("locAction"))

        val add = WertisJson.encodeToString(
            PutawayLineBody.serializer(), PutawayLineBody("PAL-042", locAction = LocApplyAction.ADD)
        )
        assertTrue(add.contains("\"add\""))
        val replace = WertisJson.encodeToString(
            PutawayLineBody.serializer(), PutawayLineBody("PAL-043", locAction = LocApplyAction.REPLACE)
        )
        assertTrue(replace.contains("\"replace\""))
    }

    @Test fun `postep dostawy niesie licznik problemow`() {
        val v = WertisJson.decodeFromString<DeliveryView>(
            """{"id":1,"dokId":2,"nrPelny":"FZ 1","dostawca":"X","dataWyst":"","status":"open",
                "progress":{"total":5,"done":3,"remaining":2,"problems":2},"lines":[]}"""
        )
        assertEquals(2, v.progress.problems)

        // starszy serwer bez pola nie może wywrócić kolektora
        val old = WertisJson.decodeFromString<DeliveryProgress>("""{"total":1,"done":1,"remaining":0}""")
        assertEquals(0, old.problems)
    }

    @Test fun `raport kolizji EAN`() {
        val r = WertisJson.decodeFromString<EanConflictsResponse>(
            """{"conflicts":[{"ean":"5905947596430","hits":4,"autoResolved":3,
                "twIds":[1,2],"lastSeen":"2026-07-25T10:00:00Z"}]}"""
        )
        val c = r.conflicts.single()
        assertEquals(4, c.hits)
        assertEquals(listOf(1L, 2L), c.twIds)
    }
}
