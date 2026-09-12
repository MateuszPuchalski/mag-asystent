package pl.wertis.kolektor.core.wms

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import pl.wertis.kolektor.core.scan.Scan
import pl.wertis.kolektor.core.scan.ScanKind

@Serializable
data class WmsReplenishmentPlan(val tw_id: Long, val sku: String, val name: String, val barcode: String? = null,
    val source: String, val target: String, val quantity: Long, val source_available: Long,
    val source_version: Int, val target_version: Int) {
    val take: Int get() = minOf(quantity, source_available, 1000000L).coerceAtLeast(0).toInt()
}
@Serializable
data class WmsReplenishmentTask(val id: Long, val tw_id: Long, val sku: String, val name: String,
    val barcode: String? = null, val source: String, val target: String, val quantity: Int, val user_id: Long,
    val completed_at: String? = null, val cancelled_at: String? = null, val moved: Int? = null,
    val reason: String? = null, val blocked: String? = null,
    val returned_quantity: Int = 0, val target_full: Int = 0)
@Serializable
data class WmsReplenishmentQueue(val view: String, val plans: List<WmsReplenishmentPlan>, val tasks: List<WmsReplenishmentTask>, val total: Int)
data class WmsReplenishmentDraft(val taskId: Long?, val path: String, val body: JsonObject, val description: String)
data class WmsReplenishmentScan(val source: Boolean = false, val barcode: String? = null, val quantity: Int? = null, val reason: String? = null,
    val targetFull: Boolean = false, val placed: Int? = null, val targetConfirmed: Boolean = false)
enum class WmsReplenishmentStage { SOURCE, PRODUCT, QUANTITY, TARGET, SPACE_QUANTITY, SPACE_TARGET, SPACE_RETURN, BLOCKED, OTHER, DONE }

fun replenishmentStage(task: WmsReplenishmentTask, actor: Long, scan: WmsReplenishmentScan): WmsReplenishmentStage = when {
    task.completed_at != null || task.cancelled_at != null -> WmsReplenishmentStage.DONE
    task.user_id != actor -> WmsReplenishmentStage.OTHER
    task.blocked != null -> WmsReplenishmentStage.BLOCKED
    !scan.source -> WmsReplenishmentStage.SOURCE
    scan.barcode == null -> WmsReplenishmentStage.PRODUCT
    scan.quantity == null -> WmsReplenishmentStage.QUANTITY
    scan.targetFull && scan.placed == null -> WmsReplenishmentStage.SPACE_QUANTITY
    scan.targetFull && !scan.targetConfirmed -> WmsReplenishmentStage.SPACE_TARGET
    scan.targetFull -> WmsReplenishmentStage.SPACE_RETURN
    else -> WmsReplenishmentStage.TARGET
}
fun replenishmentCode(stage: WmsReplenishmentStage?, input: Scan): String =
    if (stage in setOf(WmsReplenishmentStage.SOURCE, WmsReplenishmentStage.TARGET, WmsReplenishmentStage.SPACE_TARGET, WmsReplenishmentStage.SPACE_RETURN) && input.kind == ScanKind.LOC) input.code else input.rawCode

fun replenishmentClaim(plan: WmsReplenishmentPlan): WmsReplenishmentDraft {
    require(plan.take > 0) { "Odśwież dostępny zapas" }
    return WmsReplenishmentDraft(null, "api/wms/replenishments", buildJsonObject {
        put("twId", plan.tw_id); put("source", plan.source); put("target", plan.target); put("quantity", plan.take)
        put("sourceVersion", plan.source_version); put("targetVersion", plan.target_version)
    }, "Podjęcie ${plan.take} × ${plan.sku}: ${plan.source} → ${plan.target}")
}
fun replenishmentScan(task: WmsReplenishmentTask, actor: Long, scan: WmsReplenishmentScan, raw: String): WmsReplenishmentScan {
    val code = raw.trim()
    require(code.isNotEmpty() && code.length <= 120) { "Nieprawidłowy kod" }
    return when (replenishmentStage(task, actor, scan)) {
        WmsReplenishmentStage.SOURCE -> {
            require(code.equals(task.source, true)) { "Zeskanuj zaplecze ${task.source}" }
            scan.copy(source = true)
        }
        WmsReplenishmentStage.PRODUCT -> {
            require(code.equals(task.sku, true) || code == task.barcode) { "Inna część. Oczekuję ${task.sku}" }
            scan.copy(barcode = code)
        }
        else -> throw IllegalArgumentException("Potwierdź stan zadania i policzoną ilość")
    }
}
fun replenishmentQuantity(task: WmsReplenishmentTask, actor: Long, scan: WmsReplenishmentScan, raw: String, reason: String): WmsReplenishmentScan {
    require(replenishmentStage(task, actor, scan) == WmsReplenishmentStage.QUANTITY) { "Najpierw zeskanuj źródło i część" }
    val quantity = raw.trim().toIntOrNull()
    require(quantity != null && quantity in 0..task.quantity) { "Wpisz ilość od 0 do ${task.quantity}" }
    val note = reason.trim().takeIf { quantity < task.quantity }
    require(note == null || note.length in 3..500) { "Opisz brakujące sztuki na źródle" }
    return scan.copy(quantity = quantity, reason = note)
}
fun replenishmentFinish(task: WmsReplenishmentTask, actor: Long, scan: WmsReplenishmentScan, raw: String): WmsReplenishmentDraft {
    require(replenishmentStage(task, actor, scan) == WmsReplenishmentStage.TARGET) { "Najpierw zeskanuj źródło, część i potwierdź ilość" }
    require(raw.trim().equals(task.target, true)) { "Odłóż towar i zeskanuj półkę ${task.target}" }
    require(scan.quantity in 0..task.quantity && (scan.quantity == task.quantity || scan.reason?.length in 3..500)) { "Potwierdź ilość i opis braku" }
    return WmsReplenishmentDraft(task.id, "api/wms/replenishments/${task.id}/complete", buildJsonObject {
        put("source", task.source); put("target", task.target); put("barcode", scan.barcode); put("quantity", scan.quantity)
        scan.reason?.let { put("reason", it) }
    }, "Uzupełnienie ${scan.quantity} × ${task.sku}: ${task.source} → ${task.target}")
}
fun replenishmentCancel(task: WmsReplenishmentTask, actor: Long, raw: String, reason: String): WmsReplenishmentDraft {
    require(task.user_id == actor && task.completed_at == null && task.cancelled_at == null) { "Odśwież własne otwarte zadanie" }
    require(raw.trim().equals(task.source, true)) { "Odłóż pobrane sztuki na ${task.source} i zeskanuj źródło" }
    require(reason.trim().length in 3..500) { "Opisz powód anulowania" }
    return WmsReplenishmentDraft(task.id, "api/wms/replenishments/${task.id}/cancel", buildJsonObject {
        put("source", task.source); put("reason", reason.trim())
    }, "Anulowanie ${task.sku} po zwrocie na ${task.source}")
}

fun replenishmentSpaceStart(task: WmsReplenishmentTask, actor: Long, scan: WmsReplenishmentScan): WmsReplenishmentScan {
    require(replenishmentStage(task, actor, scan) == WmsReplenishmentStage.TARGET && (scan.quantity ?: 0) > 0) { "Najpierw potwierdź pobrane sztuki" }
    return scan.copy(targetFull = true)
}
fun replenishmentSpaceQuantity(task: WmsReplenishmentTask, actor: Long, scan: WmsReplenishmentScan, raw: String, reason: String): WmsReplenishmentScan {
    require(replenishmentStage(task, actor, scan) == WmsReplenishmentStage.SPACE_QUANTITY) { "Otwórz zgłoszenie pełnego celu" }
    val placed = raw.trim().toIntOrNull()
    require(placed != null && placed in 0 until (scan.quantity ?: 0)) { "Wpisz od 0 do ${(scan.quantity ?: 1) - 1} odłożonych sztuk" }
    require(reason.trim().length in 3..500) { "Opisz brak miejsca na celu" }
    // Brak na źródle i brak miejsca mogą wystąpić razem; zachowujemy oba opisy.
    val note = listOfNotNull(scan.reason, reason.trim()).distinct().joinToString("; ")
    require(note.length <= 500) { "Skróć wspólny opis braków do 500 znaków" }
    return scan.copy(placed = placed, reason = note)
}
fun replenishmentSpaceTarget(task: WmsReplenishmentTask, actor: Long, scan: WmsReplenishmentScan, raw: String): WmsReplenishmentScan {
    require(replenishmentStage(task, actor, scan) == WmsReplenishmentStage.SPACE_TARGET) { "Potwierdź odłożoną ilość" }
    require(raw.trim().equals(task.target, true)) { "Zeskanuj cel ${task.target}" }
    return scan.copy(targetConfirmed = true)
}
fun replenishmentSpaceFinish(task: WmsReplenishmentTask, actor: Long, scan: WmsReplenishmentScan, raw: String): WmsReplenishmentDraft {
    require(replenishmentStage(task, actor, scan) == WmsReplenishmentStage.SPACE_RETURN) { "Najpierw potwierdź ilość oraz cel" }
    require(raw.trim().equals(task.source, true)) { "Zwróć pozostałe sztuki na ${task.source} i zeskanuj źródło" }
    return WmsReplenishmentDraft(task.id, "api/wms/replenishments/${task.id}/complete", buildJsonObject {
        put("source", task.source); put("target", task.target); put("barcode", scan.barcode)
        put("quantity", scan.placed); put("pickedQuantity", scan.quantity); put("targetFull", true)
        put("returnedSource", task.source); put("reason", scan.reason)
    }, "Pełny cel ${task.target}: odłożono ${scan.placed}, zwrócono ${(scan.quantity ?: 0) - (scan.placed ?: 0)} × ${task.sku}")
}
