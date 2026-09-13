package pl.wertis.kolektor.core.wms

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

@Serializable
data class WmsPutbackTask(val id:Long,val order_id:Long,val reference:String,val box:String,val station:String,val reason:String,
    val version:Int,val order_version:Int,val user_id:Long?=null,val completed_at:String?=null,val cancelled_at:String?=null,val picks:List<WmsReturnTask>)
@Serializable
data class WmsPutbackSummary(val id:Long,val reference:String,val box:String,val station:String,val remaining:Int,val user_id:Long?=null)
@Serializable
data class WmsPutbackQueue(val rows:List<WmsPutbackSummary>,val total:Int)
data class WmsPutbackDraft(val taskId:Long,val path:String,val body:JsonObject,val description:String)

fun putbackClaim(task:WmsPutbackTask,station:String,box:String):WmsPutbackDraft {
    require(task.user_id==null && task.completed_at==null && task.cancelled_at==null && task.picks.isNotEmpty()) { "Odśwież zlecony zwrot" }
    require(station.trim()==task.station && box.trim()==task.box) { "Zeskanuj stanowisko ${task.station} i skrzynkę ${task.box}" }
    return WmsPutbackDraft(task.id,"api/wms/putback/${task.id}/claim",buildJsonObject {
        put("version",task.version);put("box",task.box);put("station",task.station);put("contentsConfirmed",true)
    },"Odbiór całej zawartości ${task.box} ze stanowiska ${task.station}")
}
fun putbackScan(task:WmsPutbackTask,actor:Long,part:WmsReturnTask,scan:WmsReturnScan,raw:String,damaged:Boolean=false,reason:String=""):Pair<WmsReturnScan,WmsPutbackDraft?> {
    require(task.user_id==actor && task.completed_at==null && task.cancelled_at==null && part in task.picks) { "Odśwież własny zwrot" }
    val code=raw.trim()
    require(code.isNotBlank() && code.length<=120) { "Nieprawidłowy kod" }
    return when(returnStage(scan)) {
        WmsReturnStage.BOX -> { require(code==task.box) { "Zeskanuj skrzynkę ${task.box}" };scan.copy(box=true) to null }
        WmsReturnStage.PRODUCT -> { require(code.equals(part.sku,ignoreCase=true)||code==part.barcode) { "Zeskanuj część ${part.sku}" };scan.copy(barcode=code) to null }
        WmsReturnStage.QUANTITY -> throw IllegalArgumentException("Najpierw policz i potwierdź ilość")
        WmsReturnStage.BIN -> {
            if(damaged) {
                require(scan.quantity!=null && scan.quantity in 1..part.remaining) { "Policz uszkodzone sztuki" }
                require(reason.trim().length in 3..500) { "Opisz uszkodzenie przed odłożeniem" }
                require(code.matches(Regex("^[A-Z0-9][A-Z0-9-]{0,29}$"))) { "Zeskanuj kwarantannę" }
                return scan to WmsPutbackDraft(task.id,"api/wms/putback/${task.id}/damage",buildJsonObject {
                    put("version",task.version);put("orderVersion",task.order_version);put("box",task.box);put("allocationId",part.allocation_id)
                    put("barcode",scan.barcode);put("quantity",scan.quantity);put("quarantine",code);put("reason",reason.trim())
                },"Kwarantanna ${scan.quantity} × ${part.sku}: ${task.box} → $code")
            }
            val target=returnDestination(part,scan,code)
            scan to WmsPutbackDraft(task.id,"api/wms/putback/${task.id}/finish",buildJsonObject {
                put("version",task.version);put("orderVersion",task.order_version);put("box",task.box);put("allocationId",part.allocation_id)
                put("bin",part.bin);if(target!=part.bin)put("target",target)
                put("barcode",scan.barcode);put("quantity",scan.quantity)
            },"Zwrot ${scan.quantity} × ${part.sku}: ${task.box} → $target")
        }
    }
}
fun putbackRelease(task:WmsPutbackTask,actor:Long,station:String,box:String,reason:String):WmsPutbackDraft {
    require(task.user_id==actor && task.completed_at==null && task.cancelled_at==null) { "Zwrot nie należy do operatora" }
    require(station.trim()==task.station && box.trim()==task.box) { "Zwróć resztę w skrzynce ${task.box} na ${task.station} i zeskanuj oba kody" }
    require(reason.trim().length in 3..500) { "Podaj powód zwolnienia" }
    return WmsPutbackDraft(task.id,"api/wms/putback/${task.id}/release",buildJsonObject {
        put("version",task.version);put("box",task.box);put("station",task.station);put("reason",reason.trim())
    },"Zwolnienie zwrotu po oddaniu ${task.box} na ${task.station}")
}
