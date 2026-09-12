package pl.wertis.kolektor.core.wms

/** Odpowiedź może rozliczyć zapis po wyjściu z ekranu, ale nie może uzbroić następnego skanu.
 * Numer wejścia odróżnia także dwa szybkie powroty na ten sam ekran. Wywołania są na wątku UI. */
class WmsVerification {
    private var epoch = 0L
    private var active = true
    fun activate() { epoch++; active = true }
    fun invalidate() { epoch++; active = false }
    fun capture(): Long? = epoch.takeIf { active }
    fun matches(captured: Long?): Boolean = active && captured != null && captured == epoch
}
