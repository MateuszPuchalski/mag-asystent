package pl.wertis.kolektor.core.wms

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import pl.wertis.kolektor.core.scan.Scan
import pl.wertis.kolektor.core.scan.ScanKind

@Serializable
data class WmsRecoveryLine(val id: Long, val sku: String, val quantity: Int, val replaced: Int, val quarantine: String)
@Serializable
data class WmsRecoveryPick(val allocation_id: Long, val tw_id: Long, val sku: String, val name: String, val barcode: String? = null,
    val bin: String, val quantity: Int, val stock_version: Int, val blocked: String? = null)
@Serializable
data class WmsRecoveryTask(val id: Long, val order_id: Long, val user_id: Long? = null, val version: Int, val reference: String,
    val box: String? = null, val hold_reason: String? = null, val completed_at: String? = null, val cancelled_at: String? = null,
    val lines: List<WmsRecoveryLine>, val picks: List<WmsRecoveryPick>)
@Serializable
data class WmsRecoverySummary(val id: Long, val reference: String, val box: String? = null, val user_id: Long? = null, val remaining: Int)
@Serializable
data class WmsRecoveryQueue(val rows: List<WmsRecoverySummary>, val total: Int)
data class WmsRecoveryDraft(val taskId: Long, val path: String, val body: JsonObject, val description: String)
data class WmsRecoveryScan(val allocationId: Long? = null, val source: Boolean = false, val barcode: String? = null, val quantity: Int? = null)
enum class WmsRecoveryStage { AVAILABLE, SOURCE, PRODUCT, QUANTITY, BOX, BLOCKED, OTHER, DONE }

fun recoveryPick(task: WmsRecoveryTask, scan: WmsRecoveryScan): WmsRecoveryPick? =
    if (scan.allocationId != null) task.picks.find { it.allocation_id == scan.allocationId } else task.picks.firstOrNull { it.blocked == null } ?: task.picks.firstOrNull()
fun recoveryStage(task: WmsRecoveryTask, actor: Long, scan: WmsRecoveryScan): WmsRecoveryStage = when {
    task.completed_at != null || task.cancelled_at != null -> WmsRecoveryStage.DONE
    task.hold_reason != null -> WmsRecoveryStage.BLOCKED
    task.user_id == null -> WmsRecoveryStage.AVAILABLE
    task.user_id != actor -> WmsRecoveryStage.OTHER
    recoveryPick(task, scan) == null || recoveryPick(task, scan)?.blocked != null -> WmsRecoveryStage.BLOCKED
    !scan.source -> WmsRecoveryStage.SOURCE
    scan.barcode == null -> WmsRecoveryStage.PRODUCT
    scan.quantity == null -> WmsRecoveryStage.QUANTITY
    else -> WmsRecoveryStage.BOX
}
private fun recoveryCode(raw: String) = raw.trim().uppercase()
fun recoveryClaim(task: WmsRecoveryTask, actor: Long): WmsRecoveryDraft {
    require(recoveryStage(task, actor, WmsRecoveryScan()) == WmsRecoveryStage.AVAILABLE) { "Odśwież dostępne wymiany" }
    return WmsRecoveryDraft(task.id, "api/wms/packing-recovery/${task.id}/claim", buildJsonObject { put("version", task.version) }, "Podjęcie wymiany: ${task.reference}")
}
fun recoveryScan(task: WmsRecoveryTask, actor: Long, scan: WmsRecoveryScan, input: Scan): WmsRecoveryScan {
    val stage = recoveryStage(task, actor, scan)
    val p = requireNotNull(recoveryPick(task, scan)) { "Brak pobrania" }
    return when(stage) {
        WmsRecoveryStage.SOURCE -> {
            val code = if(input.kind == ScanKind.LOC) input.code else input.rawCode
            require(recoveryCode(code) == p.bin) { "Zeskanuj źródło ${p.bin}" }
            scan.copy(allocationId=p.allocation_id, source=true)
        }
        WmsRecoveryStage.PRODUCT -> {
            require(input.rawCode.trim().equals(p.sku, ignoreCase=true) || input.rawCode.trim() == p.barcode) { "To inna część. Sprawdź ${p.sku}" }
            scan.copy(barcode=input.rawCode.trim())
        }
        else -> throw IllegalArgumentException("Wykonaj wskazany krok wymiany")
    }
}
fun recoveryQuantity(task: WmsRecoveryTask, actor: Long, scan: WmsRecoveryScan, raw: String): WmsRecoveryScan {
    require(recoveryStage(task,actor,scan)==WmsRecoveryStage.QUANTITY) { "Najpierw zeskanuj źródło i część" }
    val p = requireNotNull(recoveryPick(task,scan))
    val quantity = raw.trim().toIntOrNull()
    require(quantity != null && quantity in 1..p.quantity) { "Wpisz faktyczną ilość od 1 do ${p.quantity}" }
    return scan.copy(quantity=quantity)
}
fun recoveryFinish(task: WmsRecoveryTask, actor: Long, scan: WmsRecoveryScan, input: Scan): WmsRecoveryDraft {
    require(recoveryStage(task,actor,scan)==WmsRecoveryStage.BOX) { "Najpierw potwierdź pobranie i ilość" }
    val box = if(input.kind == ScanKind.LOC) input.code else input.rawCode
    require(recoveryCode(box)==task.box) { "Zeskanuj skrzynkę ${task.box} po dostarczeniu zamiennika" }
    val p = requireNotNull(recoveryPick(task,scan))
    return WmsRecoveryDraft(task.id,"api/wms/packing-recovery/${task.id}/pick",buildJsonObject {
        put("version",task.version);put("allocationId",p.allocation_id);put("sourceVersion",p.stock_version)
        put("source",p.bin);put("barcode",requireNotNull(scan.barcode));put("quantity",requireNotNull(scan.quantity));put("box",requireNotNull(task.box))
    },"Zamiennik ${scan.quantity} × ${p.sku} → ${task.box}")
}
fun recoveryRelease(task: WmsRecoveryTask, actor: Long, sources: Set<String>, reason: String): WmsRecoveryDraft {
    require(task.user_id == actor && task.completed_at == null && task.cancelled_at == null) { "Wymiana nie należy do operatora" }
    require(sources == task.picks.map { it.bin }.toSet()) { "Zwróć niepotwierdzone sztuki i zeskanuj wszystkie źródła" }
    require(reason.trim().length in 3..500) { "Podaj powód zwolnienia" }
    return WmsRecoveryDraft(task.id,"api/wms/packing-recovery/${task.id}/release",buildJsonObject {
        put("version",task.version);put("sources",JsonArray(sources.sorted().map(::JsonPrimitive)));put("reason",reason.trim())
    },"Zwolnienie wymiany po zwrocie: ${task.reference}")
}
