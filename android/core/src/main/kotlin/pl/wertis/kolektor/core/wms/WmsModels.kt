package pl.wertis.kolektor.core.wms

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

@Serializable
data class WmsContext(val server: String, val actorId: Long)

@Serializable
data class WmsOrder(val id: Long, val status: String, val hold_reason: String? = null)

@Serializable
data class WmsTask(
    val allocation_id: Long,
    val order_id: Long,
    val version: Int,
    val tw_id: Long,
    val sku: String,
    val name: String,
    val barcode: String? = null,
    val bin: String,
    val tote: String,
    val position: Int?,
    val remaining: Int,
    val stop_quantity: Int,
    val picker_id: Long,
    val hold_reason: String? = null,
    val stock_blocked: String? = null,
)

@Serializable
data class WmsRun(
    val id: Long,
    val cart_code: String,
    val picker_id: Long,
    val arrived_at: String? = null,
    val closed_at: String? = null,
    val orders: List<WmsOrder>,
    val tasks: List<WmsTask>,
) {
    fun nextTask(userId: Long): WmsTask? = tasks.firstOrNull {
        it.picker_id == userId && it.hold_reason == null && it.stock_blocked == null
    }
    val canHandoff: Boolean get() = orders.all {
        it.hold_reason != null || it.status in setOf("picked", "cancelled")
    }
}

data class WmsDraft(val path: String, val body: JsonObject, val description: String, val runId: Long? = null)

enum class WmsStage { CART, LOCATION, PRODUCT, BOX, HANDOFF_CART, STATION, DONE, WAIT }

data class WmsScanState(
    val location: Boolean = false,
    val barcode: String? = null,
    val quantity: Int = 1,
    val cart: Boolean = false,
)

data class WmsScanResult(
    val state: WmsScanState,
    val command: WmsDraft? = null,
    val error: String? = null,
)

fun wmsStage(run: WmsRun?, userId: Long, state: WmsScanState): WmsStage {
    if (run == null) return WmsStage.CART
    if (run.picker_id != userId) return WmsStage.WAIT
    if (run.arrived_at != null || run.closed_at != null) return WmsStage.DONE
    val task = run.nextTask(userId)
    if (task != null) {
        if (task.position == null || task.position !in 1..30 || task.remaining < 1) return WmsStage.WAIT
        return when {
            !state.location -> WmsStage.LOCATION
            state.barcode == null -> WmsStage.PRODUCT
            else -> WmsStage.BOX
        }
    }
    if (!run.canHandoff) return WmsStage.WAIT
    return if (state.cart) WmsStage.STATION else WmsStage.HANDOFF_CART
}

/** Skan nie zmienia ilości potwierdzonej przez serwer. Zdjęcie pomaga rozpoznać
 * część, ale nigdy nie zastępuje sprawdzenia kodu i właściwej skrzynki. */
fun wmsScan(run: WmsRun?, userId: Long, state: WmsScanState, raw: String): WmsScanResult {
    val code = raw.trim()
    fun reject(message: String) = WmsScanResult(state, error = message)
    if (code.isEmpty() || code.length > 128) return reject("Nieprawidłowy kod")
    val task = run?.nextTask(userId)
    return when (wmsStage(run, userId, state)) {
        WmsStage.CART -> WmsScanResult(state, WmsDraft("api/wms/cart-start", buildJsonObject {
            put("barcode", code)
        }, "Uruchomienie wózka $code"))
        WmsStage.LOCATION -> if (code == task!!.bin) WmsScanResult(state.copy(location = true))
            else reject("Zeskanuj lokalizację ${task.bin}")
        WmsStage.PRODUCT -> if (code.equals(task!!.sku, ignoreCase = true) || code == task.barcode)
            WmsScanResult(state.copy(barcode = code)) else reject("Inny towar. Oczekuję ${task.sku}")
        WmsStage.BOX -> when {
            code != task!!.tote -> reject("Inna skrzynka. Pozycja ${task.position}: ${task.tote}")
            state.quantity !in 1..task.remaining -> reject("Wpisz ilość od 1 do ${task.remaining}")
            else -> WmsScanResult(state, WmsDraft("api/wms/waves/${run!!.id}/pick", buildJsonObject {
                put("orderId", task.order_id); put("version", task.version)
                put("allocationId", task.allocation_id); put("bin", task.bin)
                put("barcode", state.barcode); put("tote", code); put("quantity", state.quantity)
            }, "${state.quantity} × ${task.sku} → ${task.tote}", run.id))
        }
        WmsStage.HANDOFF_CART -> if (code == run!!.cart_code) WmsScanResult(state.copy(cart = true))
            else reject("Zeskanuj wózek ${run.cart_code}")
        WmsStage.STATION -> WmsScanResult(state, WmsDraft("api/wms/cart-runs/${run!!.id}/handoff", buildJsonObject {
            put("cart", run.cart_code); put("station", code)
        }, "Przekazanie ${run.cart_code} do $code", run.id))
        WmsStage.DONE -> reject("Wózek przekazany. Wybierz kolejny wózek.")
        WmsStage.WAIT -> reject("Trasa wymaga odświeżenia lub pomocy biura")
    }
}

fun wmsException(run: WmsRun, task: WmsTask, box: String, kind: String, reason: String): WmsDraft {
    require(box == task.tote) { "Zeskanuj skrzynkę ${task.tote}" }
    require(kind in setOf("missing", "damaged", "box_full")) { "Nieznany rodzaj zgłoszenia" }
    require(reason.trim().length in 3..500) { "Podaj powód (3–500 znaków)" }
    return WmsDraft("api/wms/pick-exceptions", buildJsonObject {
        put("orderId", task.order_id); put("allocationId", task.allocation_id)
        put("version", task.version); put("box", box); put("kind", kind); put("reason", reason.trim())
    }, "Zgłoszenie: ${task.sku} / $box", run.id)
}
