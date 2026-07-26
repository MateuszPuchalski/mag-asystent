package pl.wertis.kolektor.data

import android.content.Context
import androidx.core.content.edit
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import pl.wertis.kolektor.core.net.LocationsInfo
import pl.wertis.kolektor.core.net.WertisJson
import pl.wertis.kolektor.core.scan.ScanConfig
import pl.wertis.kolektor.core.scan.ScanRules
import pl.wertis.kolektor.net.ApiService
import pl.wertis.kolektor.net.apiCall

/* ── Słownik lokalizacji i reguła rozpoznawania kodu ────────────────────────
   Serwer jest jedynym właścicielem wzorca (plan §3), a kolektor pracuje
   w dziurach Wi-Fi — więc ostatnia pobrana reguła musi przeżyć restart
   aplikacji. Zapis trwały, z jawnym `fetchedAt`: bez niego „mam cache" i „cache
   jest z zeszłego miesiąca" wyglądają identycznie.

   Dopóki nic nie pobrano, `ScanRules` zostaje w trybie ostrożnym — lokalizacją
   jest wyłącznie kod z prefiksem `LOC:`. Zgadywanie wzorca to dokładnie ta
   heurystyka, przez którą symbol towaru udawał adres regału.                 */

class LocationsRepository(context: Context, private val api: ApiService) {
    private val prefs = context.getSharedPreferences("wertis_locations", Context.MODE_PRIVATE)
    private val mutex = Mutex()
    private var cached: LocationsInfo? = null

    /** Odświeżenie z sieci; cache trwały służy tylko jako zapas na offline. */
    private val ttlMs = 5 * 60_000L

    init {
        // reguła musi obowiązywać od pierwszego skanu, jeszcze przed odpowiedzią serwera
        load()?.let { adopt(it) }
    }

    /** Zwraca słownik z cache; po TTL dociąga świeży. null = nigdy nie pobrano. */
    suspend fun get(): LocationsInfo? = mutex.withLock {
        val now = System.currentTimeMillis()
        val have = cached ?: load()?.also { adopt(it) }
        if (have != null && now - have.fetchedAt < ttlMs) return have
        try {
            val fresh = apiCall { api.locations() }.copy(fetchedAt = now)
            adopt(fresh)
            store(fresh)
        } catch (_: Exception) {
            /* offline — zostaje ostatnia znana reguła (albo tryb ostrożny) */
        }
        cached
    }

    /** Ostatnia znana reguła bez sięgania do sieci (wołane spoza korutyny). */
    fun cached(): LocationsInfo? = cached

    /** Reguła przestaje obowiązywać po zmianie serwera — inny magazyn, inne wzorce. */
    fun forget() {
        cached = null
        prefs.edit { remove(KEY) }
        ScanRules.reset()
    }

    private fun adopt(info: LocationsInfo) {
        cached = info
        ScanRules.apply(ScanConfig.of(info.locPatterns()))
    }

    private fun load(): LocationsInfo? =
        prefs.getString(KEY, null)?.let {
            runCatching { WertisJson.decodeFromString<LocationsInfo>(it) }.getOrNull()
        }

    private fun store(info: LocationsInfo) {
        runCatching { WertisJson.encodeToString(LocationsInfo.serializer(), info) }
            .getOrNull()
            ?.let { json -> prefs.edit { putString(KEY, json) } }
    }

    private companion object {
        const val KEY = "info"
    }
}
