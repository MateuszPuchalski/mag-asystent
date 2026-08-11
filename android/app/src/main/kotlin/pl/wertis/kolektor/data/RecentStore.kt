package pl.wertis.kolektor.data

import android.content.Context
import androidx.core.content.edit
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.builtins.ListSerializer
import pl.wertis.kolektor.core.net.WertisJson
import pl.wertis.kolektor.core.recent.RecentEntry
import pl.wertis.kolektor.core.recent.dopisz
import pl.wertis.kolektor.core.recent.odswiez

/* Ostatnio skanowane towary na ekranie głównym (wertis_recent, max 4).
   Sam zapis do preferencji — reguły listy siedzą w `:core`
   (`core/recent/OstatnioSkanowane.kt`), bo tamto da się przetestować. */

class RecentStore(context: Context) {
    private val prefs = context.getSharedPreferences("wertis_recent", Context.MODE_PRIVATE)
    private val serializer = ListSerializer(RecentEntry.serializer())

    private val _recent = MutableStateFlow(load())
    val recent: StateFlow<List<RecentEntry>> = _recent

    private fun load(): List<RecentEntry> = try {
        WertisJson.decodeFromString(serializer, prefs.getString("list", "[]") ?: "[]")
    } catch (_: Exception) {
        emptyList()
    }

    private fun zapisz(next: List<RecentEntry>) {
        // ta sama lista = brak zapisu; `odswiez` woła karta co 2 s
        if (next === _recent.value) return
        prefs.edit { putString("list", WertisJson.encodeToString(serializer, next)) }
        _recent.value = next
    }

    fun push(entry: RecentEntry) = zapisz(dopisz(_recent.value, entry))

    /**
     * Adres i nazwa po zmianie na karcie towaru.
     *
     * Bez tego lista pokazywała adres sprzed relokacji jeszcze przez cztery
     * kolejne otwarcia kart — karta mówiła jedno, ekran główny drugie.
     */
    fun odswiezWpis(id: Long, loc: String, name: String) =
        zapisz(odswiez(_recent.value, id, loc, name))
}
