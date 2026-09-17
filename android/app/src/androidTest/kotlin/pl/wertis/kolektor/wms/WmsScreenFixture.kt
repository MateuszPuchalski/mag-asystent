package pl.wertis.kolektor.wms

import java.util.concurrent.CopyOnWriteArrayList
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import pl.wertis.kolektor.core.net.WertisJson

// To kontrakt ekranów, nie symulacja księgowania. Rzeczywiste transakcje sprawdza wms-inbound-to-dispatch.test.ts.
internal class WmsScreenFixture : Dispatcher() {
    val server = MockWebServer().apply { dispatcher = this@WmsScreenFixture }
    val writes = CopyOnWriteArrayList<Pair<String, JsonObject>>()
    val unexpected = CopyOnWriteArrayList<String>()
    private var version = 1
    private var owner: Long? = null
    private var remaining = 5
    private var received = 0
    private val bins = (1..8).joinToString(",") {
        """{"bin":"A$it","on_hand":0,"mode":"pick","room":20}"""
    }

    private fun putawayJson() = """{"id":1,"tw_id":1,"source":"BUF01","quantity":5,"remaining":$remaining,
        "user_id":$owner,"version":$version,"sku":"WMS-0001","name":"Filtr powietrza do kosiarki spalinowej",
        "barcode":"5900000000017","reference":"DEMO-PZ-1","bins":[$bins]}"""

    private fun line() = """{"id":1,"inbound_id":1,"tw_id":1,"sku":"WMS-0001",
        "name":"Filtr powietrza do kosiarki spalinowej","barcode":"5900000000017",
        "expected":5,"received":$received,"damaged":0,"version":$version,"bins":[$bins]}"""

    private fun header() = """{"id":1,"reference":"DEMO-PZ-1","supplier":"Dostawca testowy","version":$version,"remaining":${5 - received}}"""

    @Synchronized
    override fun dispatch(request: RecordedRequest): MockResponse {
        val url = requireNotNull(request.requestUrl)
        val path = url.encodedPath
        fun json(body: String, status: Int = 200) = MockResponse().setResponseCode(status)
            .setHeader("Content-Type", "application/json").setBody(body)
        if (path.startsWith("/api/wms/")) {
            if (request.getHeader("x-session") != "seeded-screen-token") {
                unexpected.add("Brak sesji: $path")
                return json("""{"error":"Brak sesji"}""", 401)
            }
            if (request.method == "POST") {
                val body = WertisJson.parseToJsonElement(request.body.readUtf8()).jsonObject
                if (request.getHeader("idempotency-key").isNullOrBlank()) unexpected.add("Brak klucza: $path")
                writes.add(path to body)
                when (path) {
                    "/api/wms/putaway-work/1/claim" -> owner = 1
                    "/api/wms/putaway-work/1/finish" -> remaining -= body.getValue("quantity").jsonPrimitive.content.toInt()
                    "/api/wms/inbound/1/putaway" -> received += body.getValue("quantity").jsonPrimitive.content.toInt()
                    else -> { unexpected.add("Nieznany zapis: $path"); return json("{}", 404) }
                }
                version++
                return json("{}")
            }
            if (request.getHeader("Content-Type") != null) unexpected.add("Typ treści przy GET: $path")
            return when (path) {
                "/api/wms/putaway-work" -> json("""{"rows":[${putawayJson()}],"totals":{"tasks":1,"units":$remaining}}""")
                "/api/wms/putaway-work/1" -> json(putawayJson())
                "/api/wms/inbound" -> json("""{"rows":[${header()}],"total":1}""")
                "/api/wms/inbound/1/collector" -> {
                    val selected = if (url.queryParameter("barcode") != null || url.queryParameter("lineId") != null) line() else "null"
                    json("""{"document":${header()},"summary":{"lines":1,"expected":5,"received":$received,"damaged":0,"remaining":${5 - received}},
                        "lines":[${line()}],"total":1,"selected":$selected}""")
                }
                else -> { unexpected.add("Nieznany odczyt: $path"); json("{}", 404) }
            }
        }
        // Graf odświeża również słowniki i zdjęcie. Brak zasobu nie wymaga połączenia z rzeczywistym serwerem.
        return json("{}", 404)
    }
}
