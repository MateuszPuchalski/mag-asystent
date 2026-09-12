package pl.wertis.kolektor.core.wms

import kotlinx.serialization.json.JsonPrimitive

/** Potwierdzony przystanek żyje tylko między sąsiednimi zapisami tej samej
 * części z tej samej półki. Nie trafia do dziennika: restart i ponowienie
 * oznaczają nieznaną sytuację przy wózku, więc wymagają nowych skanów. */
fun continueWmsStop(before: WmsRun?, after: WmsRun, command: WmsPending): WmsScanState? {
    if (before == null || before.id != after.id || command.runId != after.id ||
        command.path != "api/wms/waves/${after.id}/pick" || before.cart_code != after.cart_code ||
        before.picker_id != command.context.actorId || after.picker_id != command.context.actorId ||
        after.arrived_at != null || after.closed_at != null) return null
    val previous = before.nextTask(command.context.actorId) ?: return null
    val next = after.nextTask(command.context.actorId) ?: return null
    fun field(key: String) = (command.body[key] as? JsonPrimitive)?.content
    val barcode = field("barcode") ?: return null
    val quantity = field("quantity")?.toIntOrNull() ?: return null
    if (field("allocationId")?.toLongOrNull() != previous.allocation_id ||
        field("orderId")?.toLongOrNull() != previous.order_id ||
        field("version")?.toIntOrNull() != previous.version || field("bin") != previous.bin ||
        field("tote") != previous.tote || quantity !in 1..previous.remaining ||
        !(barcode.equals(previous.sku, ignoreCase = true) || barcode == previous.barcode)) return null
    if (previous.tw_id != next.tw_id || previous.bin != next.bin || previous.sku != next.sku ||
        previous.barcode != next.barcode || previous.name != next.name ||
        next.position == null || next.position !in 1..30 || next.remaining < 1) return null
    // Przy częściowym pobraniu odpowiedź musi dowodzić postępu. Niezmieniony
    // odczyt z błędnego cache nie uprawnia do następnego potwierdzenia skrzynki.
    if (previous.allocation_id == next.allocation_id &&
        (next.version <= previous.version || next.remaining != previous.remaining - quantity)) return null
    return WmsScanState(location = true, barcode = barcode, quantity = next.remaining)
}
