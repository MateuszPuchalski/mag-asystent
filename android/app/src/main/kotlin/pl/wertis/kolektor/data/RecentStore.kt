package pl.wertis.kolektor.data

import android.content.Context
import androidx.core.content.edit
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import pl.wertis.kolektor.core.net.WertisJson

/* Ostatnio skanowane towary na ekranie głównym (wertis_recent, max 4). */

@Serializable
data class RecentEntry(val id: Long, val sym: String, val loc: String)

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

    fun push(entry: RecentEntry) {
        val next = (listOf(entry) + _recent.value.filter { it.id != entry.id }).take(4)
        prefs.edit { putString("list", WertisJson.encodeToString(serializer, next)) }
        _recent.value = next
    }
}
