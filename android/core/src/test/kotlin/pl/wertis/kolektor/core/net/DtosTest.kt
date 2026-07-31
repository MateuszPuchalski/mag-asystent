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
        // starszy serwer nie zna pola `zamienniki` — karta i tak musi się
        // zdekodować, a pusta sekcja to poprawna odpowiedź, nie awaria
        assertTrue(card.zamienniki.znane.isEmpty())
        assertTrue(card.zamienniki.obce.isEmpty())
    }

    @Test fun `ProductCard - zamienniki, klikalne osobno od numerow obcych`() {
        // `znane` to zwykłe wiersze listy, więc rysuje je ten sam komponent co
        // wyniki wyszukiwania; `obce` zostają tekstem, bo nie ma dokąd z nimi wejść
        val json = """
            {"id":7,"sym":"W10-0412","name":"Szczotka","ean":"","unit":"szt","ordered":0,
             "desc":"Zamiennik: FTC212 / EX1095","locs":[],
             "mag":{"stan":0,"rez":0,"avail":0,"pendingIn":0,"pendingOut":0,"effective":0},
             "mgp":{"stan":0,"rez":0,"avail":0,"pendingIn":0,"pendingOut":0,"effective":0},
             "zamienniki":{"znane":[{"id":9,"sym":"EX1095","name":"Szczotka nylonowa","ean":"",
                                     "mag":1,"mgp":0,"locs":["D04-01-05"]}],
                           "obce":["FTC212","M06973"]}}
        """.trimIndent()
        val card = WertisJson.decodeFromString<ProductCard>(json)
        assertEquals(1, card.zamienniki.znane.size)
        assertEquals("EX1095", card.zamienniki.znane[0].sym)
        assertEquals("D04-01-05", card.zamienniki.znane[0].locs.first())
        assertEquals(listOf("FTC212", "M06973"), card.zamienniki.obce)
    }

    @Test fun `ScanResult - skan regalu zwraca jego zawartosc`() {
        val r = WertisJson.decodeFromString<ScanResult>(
            """{"type":"location","code":"A01-02-03","known":true,
                "products":[{"id":1,"sym":"S","name":"N","ean":"","mag":3,"mgp":0,"locs":["A01-02-03"]}]}"""
        )
        val loc = r as ScanResult.Location
        assertEquals("A01-02-03", loc.code)
        assertEquals(1, loc.products.size)

        // pusty regał to POPRAWNA odpowiedź, nie błąd — i nie może wywrócić kolektora
        val pusty = WertisJson.decodeFromString<ScanResult>(
            """{"type":"location","code":"Z99-99-99"}"""
        ) as ScanResult.Location
        assertTrue(pusty.products.isEmpty())
        assertEquals(false, pusty.known)
    }

    @Test fun `LocationsInfo - regula lokalizacji przychodzi z serwera`() {
        val info = WertisJson.decodeFromString<LocationsInfo>(
            """{"codes":["A01-02-03"],"patterns":["^[A-Z]\\d{2}-\\d{2}-\\d{2}$","^PAL-\\d{3}$"],
                "version":"a1b2c3d4","format":"^[A-Z]\\d{2}-\\d{2}-\\d{2}$","strict":true,"allowManual":false}"""
        )
        assertEquals(2, info.locPatterns().size)
        assertEquals("a1b2c3d4", info.version)
        assertTrue(info.strict)

        // starszy serwer nie zna `patterns` — kolektor spada na `format`, nie na zgadywanie
        val stary = WertisJson.decodeFromString<LocationsInfo>(
            """{"codes":[],"format":"^[A-Z]\\d{2}-\\d{2}-\\d{2}$","strict":true}"""
        )
        assertEquals(listOf("^[A-Z]\\d{2}-\\d{2}-\\d{2}$"), stary.locPatterns())

        // serwer bez jednego i drugiego = reguła nieznana, tryb ostrożny
        assertTrue(WertisJson.decodeFromString<LocationsInfo>("""{}""").locPatterns().isEmpty())
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

    @Test fun `QueueItemType zna DAWNE zadanie flagi faktury`() {
        // Flagi faktur już nie ma, ale w kolejce wdrożonych instalacji leżą stare
        // wiersze. `type` nie ma wartości domyślnej, więc nieznana wartość rzuca
        // wyjątkiem — czyli ekran kolejki padłby na każdej bazie z historią.
        val r = WertisJson.decodeFromString<QueueResponse>(
            """{"items":[{"id":9,"type":"set_doc_flag","status":"pending",
                "label":"Flaga · FZ 1","detail":"W trakcie sprawdzania","errMsg":null,"time":"12:00"}],
                "summary":{"pending":1,"error":0,"done":0}}"""
        )
        assertEquals(QueueItemType.SET_DOC_FLAG, r.items[0].type)
        assertEquals("W trakcie sprawdzania", r.items[0].detail)
    }

    @Test fun `ScanResolution - linia zajeta przez kogos innego`() {
        val r = WertisJson.decodeFromString<ScanResolution>(
            """{"kind":"locked","code":"5901234","lockedBy":"anna","sym":"W04-0103","name":"Wąż"}"""
        )
        assertEquals("anna", (r as ScanResolution.Locked).lockedBy)
    }

    @Test fun `zwrot niesie koszyki czekajace na MM`() {
        val v = WertisJson.decodeFromString<DeliveryView>(
            """{"id":9,"dokId":7,"nrPelny":"ZW 7/07/2026","status":"open","zwrot":true,
                "koszyki":[{"numer":"1","lines":3,"qty":6}],
                "lines":[{"id":1,"twId":4,"sym":"S","name":"N","qtyDoc":2,"qtyDone":2,
                          "status":"done","aisle":"C","koszyk":"1"}]}"""
        )
        assertTrue(v.zwrot)
        assertEquals("1", v.koszyki[0].numer)
        assertEquals(6.0, v.koszyki[0].qty, 0.0)
        assertEquals("1", v.lines[0].koszyk)

        // dostawa krajowa: brak pól → zwrot fałszywy, zero koszyków (nie crash)
        val krajowa = WertisJson.decodeFromString<DeliveryView>("""{"id":10,"nrPelny":"FZ 1"}""")
        assertTrue(!krajowa.zwrot)
        assertTrue(krajowa.koszyki.isEmpty())
    }

    @Test fun `numer koszyka jedzie z odlozeniem, ale tylko gdy jest`() {
        val zZwrotem = WertisJson.encodeToString(
            PutawayLineBody.serializer(),
            PutawayLineBody("E03-04-03", koszyk = "12")
        )
        assertTrue(zZwrotem.contains("\"koszyk\":\"12\""))
        val bezZwrotu = WertisJson.encodeToString(PutawayLineBody.serializer(), PutawayLineBody("E03-04-03"))
        assertTrue(!bezZwrotu.contains("koszyk"))
    }

    @Test fun `QueueResponse - statusy i summary`() {
        val json = """
            {"items":[
              {"id":1,"type":"set_location","status":"waiting_for_doc","label":"L","detail":"D","errMsg":null,"time":"12:00"},
              {"id":2,"type":"mm","status":"error","label":"L2","detail":"","errMsg":"Błąd Sfery","time":"12:01"},
              {"id":3,"type":"mm","status":"done","label":"L3","detail":"","errMsg":null,"time":"12:02"}
             ],"summary":{"pending":1,"error":1,"done":1}}
        """.trimIndent()
        val r = WertisJson.decodeFromString<QueueResponse>(json)
        assertEquals(QueueStatus.WAITING_FOR_DOC, r.items[0].status)
        assertEquals(QueueItemType.MM, r.items[2].type)
        assertEquals("Błąd Sfery", r.items[1].errMsg)
        assertEquals(1, r.summary.error)
    }

    @Test fun `PutawaySession - pelny kszalt`() {
        val json = """
            {"id":5,"sourceDocId":11,"sourceDocNumber":"FZ 1/2026","status":"open",
             "progress":{"total":10,"done":3,"remaining":7,"onCart":2},
             "queueAlerts":[{"id":9,"type":"mm","label":"MM","detail":"x","errorMsg":"e"}],
             "inFlight":1,
             "items":[{"id":1,"twId":7,"sym":"S","name":"N","targetLoc":null,"qtyExpected":4,
                       "qtyDone":0,"delta":0,"mgpStan":4,"status":"on_cart","skipReason":null,
                       "lockedBy":"anna","offDocument":false,"stageQty":2.5,"stageLoc":"E01-01-01"}]}
        """.trimIndent()
        val s = WertisJson.decodeFromString<PutawaySession>(json)
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
            """{"docId":1,"typ":"FZ","nrPelny":"FZ 1","dataWyst":"2026-07-01","dostawca":"X","positions":3,
                "session":{"id":2,"status":"open","progressPct":50}}"""
        )
        assertEquals(50.0, d1.session!!.progressPct, 0.0)
        val d2 = WertisJson.decodeFromString<PutawayDocument>(
            """{"docId":2,"typ":"PZ","nrPelny":"PZ 9","dataWyst":"","dostawca":"","positions":1}"""
        )
        assertNull(d2.session)
    }

    @Test fun `ScanResolution rozroznia kolizje EAN od linii`() {
        // `aisle` NIE jest już polem DTO — kolektor przestał grupować listę po
        // alejkach, gdy okazało się, że rozkłada się „co wpadnie w rękę". Serwer
        // dalej je wysyła (dalej po nim sortuje), więc to zostaje w JSON-ie
        // celowo: gdyby `ignoreUnknownKeys` kiedyś zniknęło, ten test padnie
        // zamiast wywalić rozkładanie na kolektorze.
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

    @Test fun `lokalizacje w drodze - obok locs, nie zamiast`() {
        val card = WertisJson.decodeFromString<ProductCard>(
            """{"id":7,"sym":"AB-1","name":"N","ean":"","unit":"szt","ordered":0,"desc":"",
                "locs":["E08-03-01"],
                "pendingLocs":[{"code":"C03-01-02","kind":"add","status":"pending","queueId":41},
                               {"code":"E08-03-01","kind":"remove","status":"error","queueId":42}],
                "mag":{"stan":0,"rez":0,"avail":0,"pendingIn":0,"pendingOut":0,"effective":0},
                "mgp":{"stan":0,"rez":0,"avail":0,"pendingIn":0,"pendingOut":0,"effective":0}}"""
        )
        // `locs` zostaje prawdą z Subiekta — niepotwierdzone leżą osobno
        assertEquals(listOf("E08-03-01"), card.locs)
        assertEquals("add", card.pendingLocs[0].kind)
        assertEquals(41L, card.pendingLocs[0].queueId)
        assertEquals("error", card.pendingLocs[1].status)

        // starszy serwer bez pola nie może wywrócić kolektora
        val stary = WertisJson.decodeFromString<ProductCard>(
            """{"id":7,"sym":"AB-1","name":"N","ean":"","unit":"szt","ordered":0,"desc":"","locs":[],
                "mag":{"stan":0,"rez":0,"avail":0,"pendingIn":0,"pendingOut":0,"effective":0},
                "mgp":{"stan":0,"rez":0,"avail":0,"pendingIn":0,"pendingOut":0,"effective":0}}"""
        )
        assertTrue(stary.pendingLocs.isEmpty())

        // znacznik półki tylko przy zawartości regału; w wyszukiwarce null
        val naPolce = WertisJson.decodeFromString<ProductRow>(
            """{"id":1,"sym":"S","name":"N","ean":"","mag":1,"mgp":0,"locs":[],"pendingHere":"add"}"""
        )
        assertEquals("add", naPolce.pendingHere)
        val zWyszukiwarki = WertisJson.decodeFromString<ProductRow>(
            """{"id":1,"sym":"S","name":"N","ean":"","mag":1,"mgp":0,"locs":[]}"""
        )
        assertNull(zWyszukiwarki.pendingHere)
    }

    @Test fun `zamowienia u dostawcy na karcie towaru`() {
        val p = WertisJson.decodeFromString<ProductCard>(
            """{"id":7,"sym":"AB-1","name":"N","ean":"","unit":"szt","desc":"","locs":[],
                "mag":{"stan":0,"rez":0,"avail":0,"pendingIn":0,"pendingOut":0,"effective":0},"mgp":{"stan":0,"rez":0,"avail":0,"pendingIn":0,"pendingOut":0,"effective":0},
                "zwroty":{"stan":0,"rez":0,"avail":0,"pendingIn":0,"pendingOut":0,"effective":0},
                "zamowione":[
                  {"dokId":41,"nrPelny":"ZD 41/2026","dataWyst":"2026-07-01",
                   "termin":"2026-08-05","dostawca":"HURT-AB","ilosc":15,"szacunek":false},
                  {"dokId":42,"nrPelny":"ZD 42/2026","dataWyst":"2026-06-01",
                   "termin":null,"dostawca":"","ilosc":4,"szacunek":true}]}"""
        )
        assertEquals(2, p.zamowione.size)
        assertEquals(15.0, p.zamowione[0].ilosc, 0.0)
        // termin bywa nieznany i MUSI przejść jako null — podstawienie daty
        // wystawienia w to miejsce byłoby obietnicą, której nikt nie złożył
        assertNull(p.zamowione[1].termin)
        assertEquals(true, p.zamowione[1].szacunek)
    }

    @Test fun `stary serwer bez pola zamowione nie wywraca karty`() {
        /* APK aktualizuje się przez MDM, serwer przez `git pull` — te dwa
           zdarzenia nigdy nie są jednoczesne. Kolektor z nową kartą musi
           przeżyć odpowiedź serwera sprzed 0.7.0, a `ordered` z takiej
           odpowiedzi ma po cichu wypaść (pole już nie istnieje). */
        val p = WertisJson.decodeFromString<ProductCard>(
            """{"id":7,"sym":"AB-1","name":"N","ean":"","unit":"szt","ordered":12,"desc":"",
                "locs":[],"mag":{"stan":0,"rez":0,"avail":0,"pendingIn":0,"pendingOut":0,"effective":0},"mgp":{"stan":0,"rez":0,"avail":0,"pendingIn":0,"pendingOut":0,"effective":0},
                "zwroty":{"stan":0,"rez":0,"avail":0,"pendingIn":0,"pendingOut":0,"effective":0}}"""
        )
        assertEquals(emptyList<ZamowioneUDostawcy>(), p.zamowione)
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
