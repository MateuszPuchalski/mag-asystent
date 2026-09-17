package pl.wertis.kolektor.core.wms

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import pl.wertis.kolektor.core.scan.Scan
import pl.wertis.kolektor.core.scan.ScanKind

@Serializable
data class WmsCountTask(val id: Long, val tw_id: Long, val bin: String, val sku: String, val name: String,
    val barcode: String? = null, val version: Int, val pending: Int = 0, val resolved_at: String? = null,
    val reason: String, val recount_reason: String? = null)
@Serializable
data class WmsCountTotals(val tasks: Int)
@Serializable
data class WmsCountQueue(val rows: List<WmsCountTask>, val totals: WmsCountTotals)
data class WmsCountDraft(val taskId: Long, val path: String, val body: JsonObject, val description: String)
data class WmsCountScan(val bin: Boolean = false, val barcode: String? = null)
enum class WmsCountStage { BIN, PRODUCT, QUANTITY, PENDING, DONE }

fun countStage(task: WmsCountTask, scan: WmsCountScan): WmsCountStage = when {
    task.resolved_at != null -> WmsCountStage.DONE
    task.pending != 0 -> WmsCountStage.PENDING
    !scan.bin -> WmsCountStage.BIN
    scan.barcode == null -> WmsCountStage.PRODUCT
    else -> WmsCountStage.QUANTITY
}
fun countCode(stage: WmsCountStage, input: Scan): String =
    if (stage == WmsCountStage.BIN && input.kind == ScanKind.LOC) input.code else input.rawCode

fun countScan(task: WmsCountTask, scan: WmsCountScan, raw: String): WmsCountScan {
    val code = raw.trim()
    require(code.isNotEmpty() && code.length <= 120) { "Nieprawidłowy kod" }
    return when (countStage(task, scan)) {
        WmsCountStage.BIN -> {
            require(code.equals(task.bin, true)) { "Zeskanuj półkę ${task.bin}" }
            scan.copy(bin = true)
        }
        WmsCountStage.PRODUCT -> {
            require(code.equals(task.sku, true) || code == task.barcode) { "Inna część. Oczekuję ${task.sku}" }
            scan.copy(barcode = code)
        }
        else -> throw IllegalArgumentException("Najpierw odczytaj zadanie albo wpisz policzoną ilość")
    }
}

fun countDraft(task: WmsCountTask, scan: WmsCountScan, raw: String): WmsCountDraft {
    require(countStage(task, scan) == WmsCountStage.QUANTITY) { "Zeskanuj półkę i część przed liczeniem" }
    val quantity = raw.trim().toIntOrNull()
    require(quantity != null && quantity in 0..1000000) { "Wpisz policzoną ilość od 0 do 1000000" }
    return WmsCountDraft(task.id, "api/wms/stock-checks/${task.id}/observe", buildJsonObject {
        put("bin", task.bin); put("barcode", scan.barcode); put("quantity", quantity); put("version", task.version)
    }, "Przeliczenie ${task.bin} · $quantity × ${task.sku}")
}
