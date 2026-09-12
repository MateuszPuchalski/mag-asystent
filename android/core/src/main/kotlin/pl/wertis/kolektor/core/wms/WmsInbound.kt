package pl.wertis.kolektor.core.wms

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import pl.wertis.kolektor.core.scan.Scan
import pl.wertis.kolektor.core.scan.ScanKind

@Serializable
data class WmsInboundHeader(
    val id: Long, val reference: String, val supplier: String, val version: Int,
    val closed_at: String? = null, val remaining: Long = 0,
)
@Serializable
data class WmsInboundList(val rows: List<WmsInboundHeader>, val total: Int)
@Serializable
data class WmsInboundLine(
    val id: Long, val inbound_id: Long, val tw_id: Long, val sku: String, val name: String,
    val barcode: String? = null, val expected: Int, val received: Int, val damaged: Int, val version: Int,
    val bins: List<WmsPutawayBin> = emptyList(),
) {
    val remaining: Int get() = (expected - received).coerceAtLeast(0)
}
@Serializable
data class WmsInboundSummary(val lines: Int, val expected: Long, val received: Long, val damaged: Long, val remaining: Long)
@Serializable
data class WmsInboundDocument(
    val document: WmsInboundHeader, val summary: WmsInboundSummary, val lines: List<WmsInboundLine>,
    val total: Int, val selected: WmsInboundLine? = null,
)
data class WmsInboundDraft(val inboundId: Long, val lineId: Long?, val path: String, val body: JsonObject, val description: String)
data class WmsInboundScan(val barcode: String? = null, val quantity: Int? = null)
enum class WmsInboundStage { CLOSED, PRODUCT, COMPLETE, QUANTITY, DESTINATION }

fun inboundStage(document: WmsInboundDocument, scan: WmsInboundScan): WmsInboundStage = when {
    document.document.closed_at != null -> WmsInboundStage.CLOSED
    document.selected == null || scan.barcode == null -> WmsInboundStage.PRODUCT
    document.selected.remaining == 0 -> WmsInboundStage.COMPLETE
    scan.quantity == null -> WmsInboundStage.QUANTITY
    else -> WmsInboundStage.DESTINATION
}

fun inboundQuantity(line: WmsInboundLine, scan: WmsInboundScan, raw: String): WmsInboundScan {
    require(scan.barcode != null) { "Najpierw zeskanuj część" }
    val count = raw.trim().toIntOrNull()
    require(count != null && count in 1..line.remaining) { "Wpisz ilość od 1 do ${line.remaining}. Nadwyżkę zgłoś biuru" }
    return scan.copy(quantity = count)
}

fun inboundProduct(line: WmsInboundLine, raw: String): WmsInboundScan {
    val code = raw.trim()
    require(code.equals(line.sku, true) || (line.barcode != null && code == line.barcode)) { "Inna część. Oczekuję ${line.sku}" }
    return WmsInboundScan(barcode = code)
}

fun inboundDestinationCode(input: Scan): String = if (input.kind == ScanKind.LOC) input.code else input.rawCode

/** Końcowy skan zapisuje wyłącznie ilość jawnie policzoną dla wybranej części.
 * Uszkodzenie omija bufor i wymaga kwarantanny sprawdzanej na serwerze. */
fun inboundReceive(document: WmsInboundDocument, scan: WmsInboundScan, raw: String, buffer: Boolean, damaged: Boolean): WmsInboundDraft {
    require(inboundStage(document, scan) == WmsInboundStage.DESTINATION) { "Najpierw wybierz część i potwierdź ilość" }
    val line = requireNotNull(document.selected)
    require(line.inbound_id == document.document.id) { "Część nie należy do tego dokumentu" }
    require(scan.quantity != null && scan.quantity in 1..line.remaining) { "Odśwież pozostałą ilość" }
    val bin = raw.trim().uppercase()
    require(Regex("^[A-Z0-9][A-Z0-9-]{0,29}$").matches(bin)) { "Zeskanuj kod bufora lub półki" }
    return WmsInboundDraft(document.document.id, line.id, "api/wms/inbound/${document.document.id}/putaway", buildJsonObject {
        put("lineId", line.id); put("version", line.version); put("barcode", scan.barcode)
        put("quantity", scan.quantity); put("bin", bin); put("disposition", if (damaged) "damaged" else "good")
        if (buffer && !damaged) put("staged", true)
        if (damaged) put("reason", "Uszkodzenie stwierdzone podczas liczenia dostawy")
    }, "Przyjęcie ${document.document.reference}: ${scan.quantity} × ${line.sku} → $bin")
}

fun inboundClose(document: WmsInboundDocument): WmsInboundDraft {
    require(document.document.closed_at == null && document.summary.remaining == 0L) { "Braki musi rozliczyć biuro. Pozostaw dokument otwarty" }
    return WmsInboundDraft(document.document.id, null, "api/wms/inbound/${document.document.id}/close", buildJsonObject {
        put("version", document.document.version)
    }, "Zakończenie przyjęcia ${document.document.reference}")
}
