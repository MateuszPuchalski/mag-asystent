package pl.wertis.kolektor.core.loc

import pl.wertis.kolektor.core.net.LocationsInfo
import pl.wertis.kolektor.core.scan.EAN_RE

/* ── Walidacja kodów lokalizacji ────────────────────────────────────────────
   Port web/src/lib/locval.ts (lustro serwera — services/locations.ts).       */

/** Normalizacja skanu lokalizacji: uppercase, obcięcie prefiksu `LOC:` z QR. */
fun normalizeLoc(raw: String): String =
    raw.trim().uppercase().removePrefix("LOC:")

/** Walidacja kodu lokalizacji; zwraca komunikat błędu albo null gdy OK. */
fun validateLoc(code: String, info: LocationsInfo? = null): String? {
    if (code.isEmpty()) return "Pusty kod lokalizacji"
    if (Regex("\\s").containsMatchIn(code)) return "Kod lokalizacji nie może zawierać spacji"
    if (EAN_RE.matches(code)) return "To wygląda jak kod towaru (EAN), nie etykieta lokalizacji"
    if (!Regex("[A-Z]").containsMatchIn(code)) {
        return "Kod lokalizacji musi zawierać literę — to nie wygląda na miejsce"
    }
    if (info?.strict == true && info.format.isNotEmpty()) {
        try {
            if (!Regex(info.format).containsMatchIn(code)) {
                return "Kod nie pasuje do formatu lokalizacji (np. E08-03-01)"
            }
        } catch (_: Exception) {
            /* zły regex — pomiń */
        }
    }
    return null
}

/** Czy kod jest w słowniku istniejących lokalizacji. */
fun isKnownLoc(code: String, info: LocationsInfo?): Boolean =
    info?.codes?.contains(code) == true
