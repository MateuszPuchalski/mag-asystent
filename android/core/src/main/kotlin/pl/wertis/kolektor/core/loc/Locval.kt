package pl.wertis.kolektor.core.loc

import pl.wertis.kolektor.core.net.LocationsInfo
import pl.wertis.kolektor.core.scan.EAN_RE
import pl.wertis.kolektor.core.scan.ScanConfig
import pl.wertis.kolektor.core.scan.ScanRules

/* ── Walidacja kodów lokalizacji ────────────────────────────────────────────
   Lustro serwera (`services/locations.ts:validateLocationCode`), ale wzorca
   NIE trzyma — bierze go z reguły pobranej z serwera (plan §3). Gdy reguła nie
   jest znana (kolektor jeszcze nie dostał odpowiedzi), zostają wyłącznie reguły
   bazowe, a format sprawdzi serwer przy zapisie.                              */

/** Normalizacja skanu lokalizacji: uppercase, obcięcie prefiksu `LOC:` z QR. */
fun normalizeLoc(raw: String): String =
    raw.trim().uppercase().removePrefix("LOC:")

/** Reguła z podanego słownika, a gdy go brak — ta, którą zna skaner. */
private fun rules(info: LocationsInfo?): ScanConfig =
    if (info == null) ScanRules.current else ScanConfig.of(info.locPatterns())

/**
 * Walidacja kodu lokalizacji; zwraca komunikat błędu albo null gdy OK.
 *
 * Reguła „musi zawierać literę" została usunięta (plan §1): przepuszczała całą
 * rodzinę symboli towarów (`W32-0203`), a nie chroniła przed niczym, czego nie
 * łapie wzorzec.
 */
fun validateLoc(code: String, info: LocationsInfo? = null): String? {
    if (code.isEmpty()) return "Pusty kod lokalizacji"
    if (Regex("\\s").containsMatchIn(code)) return "Kod lokalizacji nie może zawierać spacji"
    if (EAN_RE.matches(code)) return "To wygląda jak kod towaru (EAN), nie etykieta lokalizacji"
    if (info?.strict == false) return null

    val cfg = rules(info)
    // brak znanego wzorca = brak podstaw do odrzucenia; rozstrzygnie serwer
    if (cfg.locPatterns.isEmpty()) return null
    if (cfg.isLoc(code)) return null

    // kod z zerem albo jednym myślnikiem to niemal zawsze SYMBOL towaru —
    // powiedz to wprost, zamiast zostawiać człowieka z „zły format"
    return if (code.count { it == '-' } <= 1 && !code.startsWith("PAL")) {
        "To kod towaru, nie etykieta regału"
    } else {
        "Kod nie pasuje do formatu lokalizacji (np. A01-02-03)"
    }
}

/** Czy kod jest w słowniku istniejących lokalizacji. */
fun isKnownLoc(code: String, info: LocationsInfo?): Boolean =
    info?.codes?.contains(code) == true
