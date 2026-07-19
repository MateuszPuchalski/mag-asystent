package pl.wertis.kolektor.data

import android.content.Context
import androidx.core.content.edit
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/* ── Ustawienia urządzenia ──────────────────────────────────────────────────
   Port web/src/lib/settings.ts, bez funkcji głosowych (voice/voiceCommands)
   i kamery (cameraScan) — usunięte z aplikacji natywnej. Nowość: serverUrl —
   PWA działała same-origin, natywna aplikacja musi znać adres serwera.       */

data class AppSettings(
    val serverUrl: String = DEFAULT_SERVER_URL,
    val wakeLock: Boolean = true, // ekran nie gaśnie podczas pracy
    val shakeUndo: Boolean = true, // potrząśnięcie = COFNIJ (w oknie karencji)
    val dropLog: Boolean = true, // log upadków urządzenia do audytu
    val walkMode: Boolean = true, // nakładka NASTĘPNE po zatwierdzeniu wózka
    val batteryAssist: Boolean = true, // podpowiedź hot-swap przy niskiej baterii
) {
    companion object {
        /** 10.0.2.2 = localhost hosta z emulatora; na kolektorze ustaw adres LAN. */
        const val DEFAULT_SERVER_URL = "http://10.0.2.2:3001"
    }
}

class SettingsRepository(context: Context) {
    private val prefs = context.getSharedPreferences("wertis_settings", Context.MODE_PRIVATE)

    private val _settings = MutableStateFlow(load())
    val settings: StateFlow<AppSettings> = _settings

    private fun load(): AppSettings = AppSettings(
        serverUrl = prefs.getString("serverUrl", AppSettings.DEFAULT_SERVER_URL) ?: AppSettings.DEFAULT_SERVER_URL,
        wakeLock = prefs.getBoolean("wakeLock", true),
        shakeUndo = prefs.getBoolean("shakeUndo", true),
        dropLog = prefs.getBoolean("dropLog", true),
        walkMode = prefs.getBoolean("walkMode", true),
        batteryAssist = prefs.getBoolean("batteryAssist", true),
    )

    val current: AppSettings get() = _settings.value

    fun update(transform: (AppSettings) -> AppSettings) {
        val next = transform(_settings.value)
        prefs.edit {
            putString("serverUrl", next.serverUrl)
            putBoolean("wakeLock", next.wakeLock)
            putBoolean("shakeUndo", next.shakeUndo)
            putBoolean("dropLog", next.dropLog)
            putBoolean("walkMode", next.walkMode)
            putBoolean("batteryAssist", next.batteryAssist)
        }
        _settings.value = next
    }
}
