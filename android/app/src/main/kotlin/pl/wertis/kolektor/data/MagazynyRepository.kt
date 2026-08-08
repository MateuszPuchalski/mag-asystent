package pl.wertis.kolektor.data

import android.content.Context
import androidx.core.content.edit
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import pl.wertis.kolektor.core.net.MagazynInfo
import pl.wertis.kolektor.core.net.MagazynyResponse
import pl.wertis.kolektor.core.net.WertisJson
import pl.wertis.kolektor.net.ApiService
import pl.wertis.kolektor.net.apiCall

/* ── Lista magazynów (role + widoczność) ────────────────────────────────────
   Ten sam kształt co LocationsRepository: pamięć + zapis trwały + TTL.
   Lista zmienia się, gdy biuro doda magazyn w Subiekcie albo ktoś przestawi
   widoczność — czyli prawie nigdy. A pytają o nią arkusz przesunięcia przy
   KAŻDYM otwarciu i Ustawienia przy każdym wejściu; arkusz do tego czasu
   stał z pustymi wyborami magazynów.                                        */

class MagazynyRepository(context: Context, private val api: ApiService) {
    private val prefs = context.getSharedPreferences("wertis_magazyny", Context.MODE_PRIVATE)
    private val mutex = Mutex()
    private var cached: List<MagazynInfo>? = null
    private var fetchedAt = 0L

    private val ttlMs = 5 * 60_000L

    init {
        // fetchedAt zostaje zerem: po restarcie lista jest od razu do rysowania,
        // ale pierwsze get() i tak dociąga świeżą
        cached = load()
    }

    /** Ostatnia znana lista bez sięgania do sieci; null = nigdy nie pobrano. */
    fun cached(): List<MagazynInfo>? = cached

    /** Lista z cache; po TTL dociąga świeżą. Offline zostaje ostatnia znana. */
    suspend fun get(): List<MagazynInfo>? = mutex.withLock {
        val now = System.currentTimeMillis()
        if (cached != null && now - fetchedAt < ttlMs) return cached
        try {
            adopt(apiCall { api.listMagazyny() }.magazyny)
        } catch (_: Exception) {
            /* offline — zostaje ostatnia znana lista */
        }
        cached
    }

    /** Wymuszone pobranie — Ustawienia chcą świeżej listy i komunikatu błędu. */
    suspend fun refresh(): List<MagazynInfo> = mutex.withLock {
        apiCall { api.listMagazyny() }.magazyny.also { adopt(it) }
    }

    /** Świeża lista przyszła przy okazji innej odpowiedzi (zapis widoczności). */
    fun przyjmij(lista: List<MagazynInfo>) = adopt(lista)

    /** Inny serwer = inne magazyny. */
    fun forget() {
        cached = null
        fetchedAt = 0
        prefs.edit { remove(KEY) }
    }

    private fun adopt(lista: List<MagazynInfo>) {
        cached = lista
        fetchedAt = System.currentTimeMillis()
        runCatching {
            WertisJson.encodeToString(MagazynyResponse.serializer(), MagazynyResponse(lista))
        }.getOrNull()?.let { json -> prefs.edit { putString(KEY, json) } }
    }

    private fun load(): List<MagazynInfo>? =
        prefs.getString(KEY, null)?.let {
            runCatching { WertisJson.decodeFromString<MagazynyResponse>(it).magazyny }.getOrNull()
        }

    private companion object {
        const val KEY = "magazyny"
    }
}
