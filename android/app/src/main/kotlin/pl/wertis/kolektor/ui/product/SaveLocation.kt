package pl.wertis.kolektor.ui.product

import pl.wertis.kolektor.AppGraph
import pl.wertis.kolektor.core.loc.isKnownLoc
import pl.wertis.kolektor.core.net.LocationsInfo
import pl.wertis.kolektor.core.net.SetLocationBody
import pl.wertis.kolektor.core.offline.PendingOp
import pl.wertis.kolektor.ui.chrome.UndoInfo

/* ── Zapis lokalizacji towaru — jedno miejsce dla karty towaru i ekranu skanu ──
   Semantyka offline (bufor) + pasek COFNIJ musi być identyczna na obu ekranach,
   więc mieszka tutaj, a nie w dwóch kopiach.                                   */

/**
 * Zapisz lokalizację (przez bufor offline) i pokaż pasek COFNIJ.
 * Rzuca wyjątkiem tylko z błędu serwera — wołający decyduje, co pokazać.
 */
suspend fun saveLocation(
    graph: AppGraph,
    productId: Long,
    choice: LocChoice,
    successMsg: String,
    locInfo: LocationsInfo?,
) {
    val warn =
        if (!isKnownLoc(choice.value, locInfo)) "Lokalizacja spoza wykazu — sprawdź etykietę" else null
    val res = graph.offlineQueue.runOrBuffer(
        kind = PendingOp.OpKind.SET_LOCATION,
        user = graph.users.currentUser,
        productId = productId,
        setLocation = SetLocationBody(choice.action, value = choice.value, replaced = choice.replaced),
    )
    graph.queueRepo.refreshNow()
    graph.feedback.beep(true)
    graph.effects.showUndo(
        UndoInfo(
            msg = if (res.offline) "Zapisano lokalnie · ${choice.value}" else "$successMsg · ${choice.value}",
            queueId = res.queueId,
            bufferId = res.bufferId,
            warn = warn,
        )
    )
}
