package pl.wertis.kolektor.core.net

/* ── Błąd odpowiedzi serwera (nie sieci!) ───────────────────────────────────
   Lustro web/src/lib/api.ts:ApiError. Kluczowy niezmiennik bufora offline:
   „błąd sieci” = KAŻDY wyjątek, który NIE jest ApiError (offline.ts).        */

open class ApiError(val status: Int, message: String) : Exception(message)

/** MM: 409 z polem `available` — przekroczono dostępny stan MGP. */
class MmConflict(status: Int, message: String, val available: Double) : ApiError(status, message)
