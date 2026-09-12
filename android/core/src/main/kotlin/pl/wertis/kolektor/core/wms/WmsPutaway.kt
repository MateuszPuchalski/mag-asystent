package pl.wertis.kolektor.core.wms

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import pl.wertis.kolektor.core.scan.Scan
import pl.wertis.kolektor.core.scan.ScanKind

@Serializable
data class WmsPutawayBin(val bin: String, val on_hand: Int, val mode: String)

@Serializable
data class WmsPutawayTask(
    val id: Long, val tw_id: Long, val source: String, val quantity: Int, val remaining: Int,
    val user_id: Long? = null, val version: Int, val sku: String, val name: String,
    val barcode: String? = null, val reference: String, val completed_at: String? = null,
    val bins: List<WmsPutawayBin> = emptyList(),
)

@Serializable
data class WmsPutawayTotals(val tasks: Int, val units: Int, val oldest: String? = null)

@Serializable
data class WmsPutawayQueue(val rows: List<WmsPutawayTask>, val totals: WmsPutawayTotals)

data class WmsPutawayDraft(val taskId: Long, val path: String, val body: JsonObject, val description: String)
data class WmsPutawayScan(val source: Boolean = false, val barcode: String? = null, val quantity: Int? = null)
enum class WmsPutawayStage { CLAIM, SOURCE, PRODUCT, QUANTITY, TARGET, DONE, OTHER }
data class WmsPutawayResult(val state: WmsPutawayScan, val command: WmsPutawayDraft? = null, val error: String? = null)

fun putawayStage(task: WmsPutawayTask, actor: Long, scan: WmsPutawayScan): WmsPutawayStage = when {
    task.remaining == 0 || task.completed_at != null -> WmsPutawayStage.DONE
    task.user_id == null -> WmsPutawayStage.CLAIM
    task.user_id != actor -> WmsPutawayStage.OTHER
    !scan.source -> WmsPutawayStage.SOURCE
    scan.barcode == null -> WmsPutawayStage.PRODUCT
    scan.quantity == null -> WmsPutawayStage.QUANTITY
    else -> WmsPutawayStage.TARGET
}

fun putawayCode(stage: WmsPutawayStage, input: Scan): String =
    if (stage in setOf(WmsPutawayStage.SOURCE, WmsPutawayStage.TARGET) && input.kind == ScanKind.LOC) input.code
    else input.rawCode

fun putawayClaim(task: WmsPutawayTask): WmsPutawayDraft {
    require(task.remaining > 0 && task.completed_at == null && task.user_id == null) { "Odśwież zadanie przed podjęciem" }
    return WmsPutawayDraft(task.id, "api/wms/putaway-work/${task.id}/claim", buildJsonObject {
        put("version", task.version)
    }, "Podjęcie ${task.sku} z ${task.source}")
}

fun putawayQuantity(task: WmsPutawayTask, scan: WmsPutawayScan, raw: String): WmsPutawayResult {
    val quantity = raw.trim().toIntOrNull()
    if (!scan.source || scan.barcode == null) return WmsPutawayResult(scan, error = "Najpierw zeskanuj bufor i część")
    if (quantity == null || quantity !in 1..task.remaining) return WmsPutawayResult(scan, error = "Wpisz ilość od 1 do ${task.remaining}")
    return WmsPutawayResult(scan.copy(quantity = quantity))
}

fun putawayScan(task: WmsPutawayTask, actor: Long, scan: WmsPutawayScan, raw: String, damaged: Boolean = false): WmsPutawayResult {
    val code = raw.trim()
    fun reject(message: String) = WmsPutawayResult(scan, error = message)
    if (code.isEmpty() || code.length > 120) return reject("Nieprawidłowy kod")
    return when (putawayStage(task, actor, scan)) {
        WmsPutawayStage.SOURCE -> if (code.equals(task.source, true)) WmsPutawayResult(scan.copy(source = true))
            else reject("Zeskanuj bufor ${task.source}")
        WmsPutawayStage.PRODUCT -> if (code.equals(task.sku, true) || code == task.barcode) WmsPutawayResult(scan.copy(barcode = code))
            else reject("Inna część. Oczekuję ${task.sku}")
        WmsPutawayStage.QUANTITY -> reject("Potwierdź policzoną ilość przed skanem półki")
        WmsPutawayStage.TARGET -> {
            if (scan.quantity !in 1..task.remaining) return reject("Ilość przekracza pozostałe sztuki. Odśwież zadanie")
            val target = code.uppercase()
            if (!Regex("^[A-Z0-9][A-Z0-9-]{0,29}$").matches(target)) return reject("Zeskanuj kod półki docelowej")
            if (target == task.source) return reject("Półka docelowa musi być inna niż bufor ${task.source}")
            WmsPutawayResult(scan, WmsPutawayDraft(task.id, "api/wms/putaway-work/${task.id}/finish", buildJsonObject {
                put("version", task.version); put("source", task.source); put("target", target)
                put("barcode", scan.barcode); put("quantity", scan.quantity)
                if (damaged) {
                    put("disposition", "damaged")
                    put("reason", "Uszkodzenie wykryte podczas odkładania z bufora")
                }
            }, "${scan.quantity} × ${task.sku}: ${task.source} → $target${if (damaged) " · kwarantanna" else ""}"))
        }
        WmsPutawayStage.CLAIM -> reject("Najpierw podejmij zadanie")
        WmsPutawayStage.OTHER -> reject("Zadanie wykonuje inna osoba. Wróć do kolejki")
        WmsPutawayStage.DONE -> reject("Zadanie zakończone. Wróć do kolejki")
    }
}
