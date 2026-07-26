package pl.wertis.kolektor.core.pin

/* ── Kontekst przyklejony: parowanie LOKALIZACJA ↔ TOWAR w obie strony ──────
   Magazynier stojący przy jednym regale i odkładający osiem indeksów musiał
   dotąd na każdy z nich zaczynać od towaru i przechodzić tę samą ścieżkę
   ekranów. Kontekst „stoję przy A01-02-03" — jedyna informacja, która się
   w tej sytuacji NIE zmienia — nie był nigdzie utrzymywany.

   Przypięty zostaje slot zeskanowany jako PIERWSZY. To nie jest arbitralne:
   kto zaczął od regału, stoi przy regale i odłoży tam kilka indeksów; kto
   zaczął od towaru, trzyma pudełko i szuka dla niego miejsca. Aplikacja
   zostaje w trybie, w którym już jest ciało pracownika, i wnioskuje to
   z kolejności skanów — zamiast o to pytać.

   Ta klasa jest czystym stanem (zegar wstrzykiwany), bo wygasanie przypięcia
   jest wymaganiem BEZPIECZEŃSTWA DANYCH, nie wygody: kontekst, który przeżyje
   odejście pracownika od regału, zapisuje towar na półkę, przy której nikogo
   już nie ma. To błąd cichy — nic nie wygląda na zepsute, dopóki ktoś nie
   pójdzie po towar.                                                          */

sealed interface Pin {
    /** Czas ostatniego skanu w tym kontekście — od niego liczy się TTL. */
    val at: Long

    data class Loc(val code: String, override val at: Long) : Pin
    data class Tow(val twId: Long, val sym: String, override val at: Long) : Pin
}

/** Co aplikacja ma zrobić po skanie. */
sealed interface PinAction {
    data class OpenLocation(val code: String) : PinAction
    data class OpenProduct(val twId: Long) : PinAction

    /** Zapisz przypisanie: TEN towar na TĘ półkę. Slot przypięty zostaje. */
    data class Assign(val twId: Long, val sym: String, val code: String) : PinAction
}

/** Dlaczego przypięcie zniknęło — do `events` i do komunikatu dla człowieka. */
enum class PinGone { TTL, AWAY, USER, MANUAL }

data class PinExpiry(val pin: Pin, val reason: PinGone, val heldMs: Long)

/**
 * Stan przypięcia z jawnym zegarem.
 *
 * @param ttlMs bezczynność, po której kontekst przestaje obowiązywać
 * @param awayMs wygaszony ekran / aplikacja w tle dłużej niż to = wygaśnięcie
 *   natychmiastowe, niezależnie od TTL (odejście od regału jest mocniejszym
 *   sygnałem niż sam upływ czasu)
 */
class PinState(
    private val ttlMs: Long,
    private val awayMs: Long,
    private val now: () -> Long,
) {
    var pin: Pin? = null
        private set

    /** Ostatnie wygaśnięcie do zaraportowania — czyta je UI i zeruje. */
    fun clear(reason: PinGone): PinExpiry? {
        val p = pin ?: return null
        pin = null
        return PinExpiry(p, reason, now() - p.at)
    }

    /**
     * Sprawdzenie przed KAŻDYM skanem. Zwraca opis wygaśnięcia, gdy do niego
     * doszło — nie „po cichu", bo następny skan nie może wpaść w stary kontekst.
     */
    fun expireIfStale(): PinExpiry? {
        val p = pin ?: return null
        return if (now() - p.at >= ttlMs) clear(PinGone.TTL) else null
    }

    /** Powrót do aplikacji po `awayFor` ms poza ekranem. */
    fun onResume(awayFor: Long): PinExpiry? =
        if (pin != null && awayFor >= awayMs) clear(PinGone.AWAY) else expireIfStale()

    /** Skan etykiety regału. */
    fun onLoc(code: String): PinAction {
        expireIfStale()
        val t = now()
        return when (val p = pin) {
            // towar w ręce + skan półki = przypisanie; TOWAR zostaje przypięty,
            // bo człowiek nadal go trzyma (może mieć dwa miejsca)
            is Pin.Tow -> {
                pin = p.copy(at = t)
                PinAction.Assign(p.twId, p.sym, code)
            }
            // przy regale: przypnij albo przepnij na nowy
            else -> {
                pin = Pin.Loc(code, t)
                PinAction.OpenLocation(code)
            }
        }
    }

    /** Skan towaru (już rozstrzygnięty przez serwer do konkretnej kartoteki). */
    fun onProduct(twId: Long, sym: String): PinAction {
        expireIfStale()
        val t = now()
        return when (val p = pin) {
            // przy regale + skan towaru = przypisanie; REGAŁ zostaje przypięty,
            // bo człowiek stoi w tym samym miejscu i odłoży tu jeszcze kilka
            is Pin.Loc -> {
                pin = p.copy(at = t)
                PinAction.Assign(twId, sym, p.code)
            }
            else -> {
                pin = Pin.Tow(twId, sym, t)
                PinAction.OpenProduct(twId)
            }
        }
    }

    /** Ile czasu zostało do wygaśnięcia (ms); 0 gdy nic nie jest przypięte. */
    fun remainingMs(): Long = pin?.let { (it.at + ttlMs - now()).coerceAtLeast(0) } ?: 0
}
