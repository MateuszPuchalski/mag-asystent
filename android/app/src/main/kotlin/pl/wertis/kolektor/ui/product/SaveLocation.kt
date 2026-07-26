package pl.wertis.kolektor.ui.product

import pl.wertis.kolektor.AppGraph
import pl.wertis.kolektor.core.loc.isKnownLoc
import pl.wertis.kolektor.core.net.LocationsInfo
import pl.wertis.kolektor.core.net.SetLocationBody
import pl.wertis.kolektor.core.offline.PendingOp
import pl.wertis.kolektor.core.session.userId

/* ── Zapis lokalizacji towaru — jedno miejsce dla karty towaru i ekranu skanu ──
   Semantyka offline (bufor) i potwierdzenie muszą być identyczne na obu
   ekranach, więc mieszkają tutaj, a nie w dwóch kopiach.

   Pasek COFNIJ został usunięty: pomyłkową lokalizację poprawia się skanując
   właściwą półkę — ta sama liczba ruchów, a bez karencji zapis rusza od razu
   zamiast czekać 5 sekund na okno anulowania.                                  */

/**
 * Zapisz lokalizację (przez bufor offline) i potwierdź na ekranie.
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
        user = graph.session.currentUser,
        // konto autora wędruje z operacją, żeby flush po zmianie zmiany
        // nie podpisał jej cudzym nazwiskiem
        userRef = graph.session.state.value.userId,
        productId = productId,
        setLocation = SetLocationBody(choice.action, value = choice.value, replaced = choice.replaced),
    )
    graph.queueRepo.refreshNow()
    graph.feedback.beep(true)
    graph.effects.flashSuccess(
        if (res.offline) "Zapisano lokalnie · ${choice.value}" else "$successMsg · ${choice.value}"
    )
    // kod spoza wykazu to nie błąd, ale magazynier ma go zobaczyć — toast żyje
    // dłużej niż plakietka sukcesu, więc nie ginie pod nią
    warn?.let { graph.effects.toast(it) }
}
