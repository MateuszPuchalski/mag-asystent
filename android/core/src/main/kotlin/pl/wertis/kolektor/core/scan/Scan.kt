package pl.wertis.kolektor.core.scan

/* ── Klasyfikacja skanów ────────────────────────────────────────────────────
   Kod ze skanera: EAN / etykieta lokalizacji / tekst.

   Reguła brzmiała kiedyś „zawiera literę, nie ma spacji, nie jest samą cyfrą
   → to lokalizacja". Pod tę regułę podpada CAŁA rodzina symboli towarów tej
   firmy (`W32-0203`), więc `LOC` była kategorią DOMYŚLNĄ — a domyślną została
   akurat ta, której pomyłka kosztuje najwięcej: zapis widmowego adresu
   o nazwie symbolu towaru.

   Teraz `LOC` jest kategorią ZAMKNIĘTĄ: kod, który nie pasuje do wzorca
   lokalizacji, lokalizacją nie jest. Wzorce pochodzą WYŁĄCZNIE z serwera
   (`GET /api/locations`) — klient nie ma własnej kopii reguły, bo trzy jej
   niezależne kopie były przyczyną tego błędu.                                */

enum class ScanKind {
    EAN,
    LOC,

    TEXT,
}

data class Scan(val code: String, val kind: ScanKind)

/** true = skan obsłużony; false = przekaż do następnego handlera/fallbacku. */
typealias ScanHandler = (Scan) -> Boolean

val EAN_RE = Regex("""^\d{8}$|^\d{12,14}$""")

const val DEFAULT_LOC_PREFIX = "LOC:"

/** Przerwa między znakami większa niż to = nowy skan (skaner wpisuje <50 ms/znak). */
const val GAP_MS = 300L
const val MIN_LEN = 3

/**
 * Reguła rozpoznawania kodu, pobrana z serwera.
 *
 * `locPatterns` PUSTE = tryb ostrożny: nie znamy jeszcze reguły (kolektor nigdy
 * nie dostał odpowiedzi z serwera), więc lokalizacją jest wyłącznie to, co
 * człowiek zadeklarował prefiksem `LOC:` z etykiety QR. Zgadywanie wzorca
 * w tym stanie byłoby powrotem do heurystyki, którą ta zmiana usuwa.
 */
data class ScanConfig(
    val locPrefix: String = DEFAULT_LOC_PREFIX,
    val locPatterns: List<Regex> = emptyList(),
) {
    fun isLoc(upperCode: String): Boolean = locPatterns.any { it.matches(upperCode) }

    companion object {
        val CAUTIOUS = ScanConfig()

        /** Kompiluje wzorce z serwera; zły regex jest pomijany, nie wywraca skanera. */
        fun of(patterns: List<String>, locPrefix: String = DEFAULT_LOC_PREFIX): ScanConfig =
            ScanConfig(locPrefix, patterns.mapNotNull { runCatching { Regex(it) }.getOrNull() })
    }
}

/**
 * Aktualna reguła. Źródła sprzętowe (Honeywell/Zebra/wedge) klasyfikują skan
 * poza Compose i poza korutyną, więc reguła musi być osiągalna globalnie —
 * `LocationsRepository` podstawia ją po każdym pobraniu słownika.
 */
object ScanRules {
    @Volatile
    var current: ScanConfig = ScanConfig.CAUTIOUS
        private set

    fun apply(cfg: ScanConfig) {
        current = cfg
    }

    /** Powrót do trybu ostrożnego — testy i zmiana adresu serwera. */
    fun reset() {
        current = ScanConfig.CAUTIOUS
    }
}

/**
 * Klasyfikacja zeskanowanego kodu. Kolejność wynika z tego, która pomyłka jest
 * droższa: prefiks (jawna deklaracja człowieka) → wzorzec lokalizacji → EAN →
 * wszystko inne jako kandydat na symbol/nazwę, którego rozstrzyga serwer.
 */
fun classify(raw: String, cfg: ScanConfig = ScanRules.current): Scan {
    val trimmed = raw.trim()
    val up = trimmed.uppercase()
    if (cfg.locPrefix.isNotEmpty() && up.startsWith(cfg.locPrefix.uppercase())) {
        return Scan(up.substring(cfg.locPrefix.length), ScanKind.LOC)
    }
    if (cfg.isLoc(up)) return Scan(up, ScanKind.LOC)
    if (EAN_RE.matches(trimmed)) return Scan(trimmed, ScanKind.EAN)
    return Scan(trimmed, ScanKind.TEXT)
}
