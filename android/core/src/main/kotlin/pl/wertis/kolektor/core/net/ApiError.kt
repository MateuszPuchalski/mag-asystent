package pl.wertis.kolektor.core.net

/* ── Błąd odpowiedzi serwera (nie sieci!) ───────────────────────────────────
   Lustro web/src/lib/api.ts:ApiError. Kluczowy niezmiennik bufora offline:
   „błąd sieci” = KAŻDY wyjątek, który NIE jest ApiError (offline.ts).        */

open class ApiError(val status: Int, message: String) : Exception(message)

/** MM: 409 z polem `available` — przekroczono dostępny stan MGP. */
class MmConflict(status: Int, message: String, val available: Double) : ApiError(status, message)

/**
 * Nadanie kodu kreskowego: 409 z powodem odmowy (0.37.0).
 *
 * DWA różne „nie" i ekran musi je rozróżnić, bo prowadzą w przeciwne strony:
 * `podmiana` da się przejść potwierdzeniem (kartoteka ma już swój kod),
 * `zajety` nie da się przejść wcale — kod należy do INNEJ kartoteki i nadanie
 * go wyprodukowałoby kolizję, którą system mierzy jako defekt danych.
 */
class EanOdmowa(
    status: Int,
    message: String,
    val powod: String,
    val eanPrzed: String?,
) : ApiError(status, message)
