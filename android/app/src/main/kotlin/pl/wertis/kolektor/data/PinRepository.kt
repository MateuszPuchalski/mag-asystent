package pl.wertis.kolektor.data

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import pl.wertis.kolektor.core.net.DeviceEventBody
import pl.wertis.kolektor.core.pin.Pin
import pl.wertis.kolektor.core.pin.PinAction
import pl.wertis.kolektor.core.pin.PinExpiry
import pl.wertis.kolektor.core.pin.PinGone
import pl.wertis.kolektor.core.pin.PinState
import pl.wertis.kolektor.net.ApiService
import pl.wertis.kolektor.net.apiCall

/* ── Kontekst przyklejony na urządzeniu ─────────────────────────────────────
   Przypięcie jest LOKALNE dla urządzenia i użytkownika, nigdy współdzielone —
   dwie osoby przy dwóch regałach to dwa różne konteksty.

   Wygaśnięcie jest GŁOŚNE: pasek znika, ekran wraca do stanu neutralnego,
   idzie jedna długa wibracja. Ciche wygaśnięcie byłoby gorsze niż brak
   mechanizmu, bo następny skan wpadłby w kontekst, o którym człowiek myśli,
   że nadal obowiązuje.                                                       */

class PinRepository(
    private val api: ApiService,
    private val scope: CoroutineScope,
    settings: SettingsRepository,
    private val onExpired: (PinExpiry) -> Unit,
) {
    private val state = PinState(
        ttlMs = settings.current.pinTtlSec * 1000L,
        awayMs = settings.current.pinAwaySec * 1000L,
        now = { System.currentTimeMillis() },
    )

    private val _pin = MutableStateFlow<Pin?>(null)
    val pin: StateFlow<Pin?> = _pin

    private fun sync() {
        _pin.value = state.pin
    }

    private fun report(e: PinExpiry?) {
        if (e == null) return
        sync()
        onExpired(e)
        // Wysoka częstość wygaszeń = ludzie są przerywani albo TTL jest za
        // krótki. To jest pomiar, nie ciekawostka — stąd zdarzenie w audycie.
        scope.launch {
            runCatching {
                apiCall {
                    api.deviceEvent(
                        DeviceEventBody(
                            type = "pin_expired",
                            reason = e.reason.name.lowercase(),
                            pinned = opis(e.pin),
                            heldMs = e.heldMs,
                        )
                    )
                }
            }
        }
    }

    fun onLoc(code: String): PinAction {
        report(state.expireIfStale())
        return state.onLoc(code).also { sync() }
    }

    fun onProduct(twId: Long, sym: String): PinAction {
        report(state.expireIfStale())
        return state.onProduct(twId, sym).also { sync() }
    }

    /** Powrót do aplikacji — odejście od regału gasi mocniej niż sam czas. */
    fun onResume(awayFor: Long) = report(state.onResume(awayFor))

    /** [X] na pasku. */
    fun release() = report(state.clear(PinGone.MANUAL))

    /** Zmiana użytkownika czyści bezwarunkowo — cudzy kontekst nie jest mój. */
    fun onUserChanged() = report(state.clear(PinGone.USER))

    fun remainingMs(): Long = state.remainingMs()

    private fun opis(p: Pin): String = when (p) {
        is Pin.Loc -> "loc:${p.code}"
        is Pin.Tow -> "tw:${p.twId}"
    }
}
