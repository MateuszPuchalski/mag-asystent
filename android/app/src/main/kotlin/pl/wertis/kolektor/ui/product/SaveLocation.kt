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
 *
 * POTWIERDZENIEM JEST CHIP LOKALIZACJI, NIE NAKŁADKA. Wcześniej leciała stąd
 * `flashSuccess` — zielony kafel na 1,5 s na ŚRODKU ekranu, dokładnie tam,
 * gdzie są chipy adresów. Zasłaniał więc jedyne miejsce, które pokazuje, co
 * naprawdę się dzieje: adres w drodze do Subiekta ma własny stan (ADDING /
 * REMOVING, bez cienia, przygaszony) i sam gaśnie na potwierdzony, gdy kolejka
 * przejdzie. Nakładka mówiła „zapisano" o sekundę za wcześnie i znikała, zanim
 * zapis faktycznie doszedł — dwa komunikaty o jednej rzeczy, z których
 * głośniejszy był mniej prawdziwy.
 */
suspend fun saveLocation(
    graph: AppGraph,
    productId: Long,
    choice: LocChoice,
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
        setLocation = SetLocationBody(
            choice.action,
            value = choice.value,
            replaced = choice.replaced,
            recznie = choice.recznie.takeIf { it },
        ),
    )
    graph.queueRepo.refreshNow()
    // sygnał ZAPISU, nie wyboru — koniec operacji słyszalny bez patrzenia
    graph.feedback.zapis()
    /* WYJĄTEK: zapis do bufora offline. Wtedy chip NIE pokaże nic — `pendingLocs`
       wylicza serwer ze SWOJEJ kolejki, a operacja jeszcze do niego nie dotarła.
       Bez tego jednego zdania zapis w trybie samolotowym nie dawałby żadnego
       potwierdzenia. Toast, nie nakładka: leży na dole, niczego nie zasłania. */
    if (res.offline) graph.effects.toast("Zapisano lokalnie · ${choice.value} — czeka na sieć")
    // kod spoza wykazu to nie błąd, ale magazynier ma go zobaczyć
    warn?.let { graph.effects.toast(it) }
}
