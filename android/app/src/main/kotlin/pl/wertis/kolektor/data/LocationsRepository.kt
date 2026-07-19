package pl.wertis.kolektor.data

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import pl.wertis.kolektor.core.net.LocationsInfo
import pl.wertis.kolektor.net.ApiService
import pl.wertis.kolektor.net.apiCall

/* Słownik lokalizacji (format, strict, allowManual) — rzadko się zmienia,
   cache 5 min jak staleTime w web/src/lib/hooks.ts. */

class LocationsRepository(private val api: ApiService) {
    private val mutex = Mutex()
    private var cached: LocationsInfo? = null
    private var fetchedAt = 0L

    private val ttlMs = 5 * 60_000L

    /** Zwraca słownik z cache; po TTL dociąga świeży. null = brak i sieć padła. */
    suspend fun get(): LocationsInfo? = mutex.withLock {
        val now = System.currentTimeMillis()
        if (cached != null && now - fetchedAt < ttlMs) return cached
        try {
            cached = apiCall { api.locations() }
            fetchedAt = now
        } catch (_: Exception) {
            /* offline — zwróć co mamy (albo null) */
        }
        cached
    }
}
