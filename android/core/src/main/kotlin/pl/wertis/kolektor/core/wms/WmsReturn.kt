package pl.wertis.kolektor.core.wms

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import pl.wertis.kolektor.core.scan.Scan
import pl.wertis.kolektor.core.scan.ScanKind

@Serializable
data class WmsReturnTask(
    val allocation_id: Long, val order_id: Long, val version: Int,
    val tw_id: Long, val sku: String, val name: String, val barcode: String? = null,
    val bin: String, val tote: String, val position: Int, val remaining: Int,
    val hold_reason: String,
)

data class WmsReturnScan(val box: Boolean = false, val barcode: String? = null, val quantity: Int? = null)
enum class WmsReturnStage { BOX, PRODUCT, QUANTITY, BIN }
fun returnStage(scan: WmsReturnScan): WmsReturnStage = when {
    !scan.box -> WmsReturnStage.BOX
    scan.barcode == null -> WmsReturnStage.PRODUCT
    scan.quantity == null -> WmsReturnStage.QUANTITY
    else -> WmsReturnStage.BIN
}
fun returnCode(scan: WmsReturnScan, input: Scan): String =
    if (returnStage(scan) == WmsReturnStage.BIN && input.kind == ScanKind.LOC) input.code else input.rawCode

fun returnQuantity(task: WmsReturnTask, scan: WmsReturnScan, raw: String): WmsReturnScan {
    require(returnStage(scan) == WmsReturnStage.QUANTITY) { "Najpierw zeskanuj skrzynkę i część" }
    val quantity = raw.trim().toIntOrNull()
    require(quantity != null && quantity in 1..task.remaining) { "Wpisz policzoną ilość od 1 do ${task.remaining}" }
    return scan.copy(quantity = quantity)
}

data class WmsReturnResult(val state: WmsReturnScan, val command: WmsDraft? = null)
fun returnScan(run: WmsRun, task: WmsReturnTask, userId: Long, scan: WmsReturnScan, raw: String): WmsReturnResult {
    require(run.picker_id == userId && run.arrived_at == null && run.closed_at == null && task in run.returns) { "Odśwież zwroty z własnego wózka" }
    require(task.remaining > 0 && task.position in 1..30 && task.hold_reason.isNotBlank()) { "Brak pobrań do odłożenia" }
    val code = raw.trim()
    require(code.isNotBlank() && code.length <= 120) { "Nieprawidłowy kod" }
    return when (returnStage(scan)) {
        WmsReturnStage.BOX -> {
            require(code == task.tote) { "Zeskanuj skrzynkę ${task.tote} na pozycji ${task.position}" }
            WmsReturnResult(scan.copy(box = true))
        }
        WmsReturnStage.PRODUCT -> {
            require(code.equals(task.sku, ignoreCase = true) || code == task.barcode) { "Zeskanuj część ${task.sku}" }
            WmsReturnResult(scan.copy(barcode = code))
        }
        WmsReturnStage.QUANTITY -> throw IllegalArgumentException("Najpierw policz i potwierdź ilość")
        WmsReturnStage.BIN -> {
            require(code == task.bin) { "Odłóż na ${task.bin} i zeskanuj tę półkę" }
            require(scan.quantity!! in 1..task.remaining) { "Ilość przekracza pozostałe pobranie" }
            // Numer trasy utrzymuje istniejący dziennik i odświeżenie bez osobnej kolejki zapisu.
            WmsReturnResult(scan, WmsDraft("api/wms/orders/${task.order_id}/actions", buildJsonObject {
                put("action", "return"); put("version", task.version); put("allocationId", task.allocation_id); put("runId", run.id)
                put("tote", task.tote); put("barcode", scan.barcode); put("quantity", scan.quantity); put("bin", code)
                put("reason", "Zwrot z wózka: ${task.hold_reason}".take(500))
            }, "Zwrot ${scan.quantity} × ${task.sku}: ${task.tote} → $code", run.id))
        }
    }
}
