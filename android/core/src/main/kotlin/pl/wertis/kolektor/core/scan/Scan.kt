package pl.wertis.kolektor.core.scan

/* ── Klasyfikacja skanów ────────────────────────────────────────────────────
   Wierne przeniesienie web/src/lib/scanner.ts: kod ze skanera (EAN / etykieta
   lokalizacji / tekst). Prefiks LOC: (z QR etykiet) rozstrzyga jednoznacznie. */

enum class ScanKind { EAN, LOC, TEXT }

data class Scan(val code: String, val kind: ScanKind)

/** true = skan obsłużony; false = przekaż do następnego handlera/fallbacku. */
typealias ScanHandler = (Scan) -> Boolean

val EAN_RE = Regex("""^\d{8}$|^\d{12,14}$""")

const val DEFAULT_LOC_PREFIX = "LOC:"

/** Przerwa między znakami większa niż to = nowy skan (skaner wpisuje <50 ms/znak). */
const val GAP_MS = 300L
const val MIN_LEN = 3

private val HAS_LETTER = Regex("[A-Z]")
private val HAS_WHITESPACE = Regex("\\s")
private val ALL_DIGITS = Regex("^\\d+$")

/** Klasyfikacja zeskanowanego kodu — port scanner.ts:classify. */
fun classify(raw: String, locPrefix: String = DEFAULT_LOC_PREFIX): Scan {
    val trimmed = raw.trim()
    val up = trimmed.uppercase()
    if (locPrefix.isNotEmpty() && up.startsWith(locPrefix.uppercase())) {
        return Scan(up.substring(locPrefix.length), ScanKind.LOC)
    }
    if (EAN_RE.matches(trimmed)) return Scan(trimmed, ScanKind.EAN)
    if (HAS_LETTER.containsMatchIn(up) && !HAS_WHITESPACE.containsMatchIn(up) && !ALL_DIGITS.matches(up)) {
        return Scan(up, ScanKind.LOC)
    }
    return Scan(trimmed, ScanKind.TEXT)
}
