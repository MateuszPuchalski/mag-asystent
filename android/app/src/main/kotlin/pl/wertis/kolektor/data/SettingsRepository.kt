package pl.wertis.kolektor.data

import android.content.Context
import androidx.core.content.edit
import java.util.UUID
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/* ── Ustawienia urządzenia ──────────────────────────────────────────────────
   Port web/src/lib/settings.ts, bez funkcji głosowych (voice/voiceCommands)
   i kamery (cameraScan) — usunięte z aplikacji natywnej. Nowość: serverUrl —
   PWA działała same-origin, natywna aplikacja musi znać adres serwera.       */

data class AppSettings(
    val serverUrl: String = DEFAULT_SERVER_URL,
    val wakeLock: Boolean = true, // ekran nie gaśnie podczas pracy
    val dropLog: Boolean = true, // log upadków urządzenia do audytu
    val batteryAssist: Boolean = true, // podpowiedź hot-swap przy niskiej baterii
) {
    companion object {
/**
         * Adres serwera na świeżej instalacji (0.72.1).
         *
         * Do tej wersji stało tu `10.0.2.2` — alias hosta Z EMULATORA, który
         * na fizycznym kolektorze nie znaczy nic. Pierwsze uruchomienie
         * kończyło się więc ekranem „Nie widzę serwera" i wpisywaniem adresu
         * z palca, na każdym urządzeniu z osobna.
         *
         * PRZEPROWADZKA SERWERA WYMAGA ZMIANY TUTAJ. Adres trzyma rezerwacja
         * DHCP (`DEPLOY.md` §4) i dopóki ona stoi, ta stała jest prawdziwa.
         * Gdyby serwer dostał inny adres, urządzenia już skonfigurowane nic
         * nie zauważą — mają swój `serverUrl` w ustawieniach — więc pomyłka
         * wyjdzie dopiero przy pierwszej instalacji od zera, czyli długo po
         * przeprowadzce i bez oczywistego związku z nią.
         *
         * Emulator jest przypadkiem szczególnym: tam adresem hosta jest
         * `http://10.0.2.2:3001` i wpisuje się go ręcznie.
         */
        const val DEFAULT_SERVER_URL = "http://192.168.1.49:3001"
    }
}

class SettingsRepository(context: Context) {
    private val prefs = context.getSharedPreferences("wertis_settings", Context.MODE_PRIVATE)

    /**
     * Trwały identyfikator egzemplarza kolektora — losowany raz, przy pierwszym
     * uruchomieniu. Świadomie NIE jest to `ANDROID_ID` ani numer seryjny: do
     * pytania „który egzemplarz to robi?" wystarczy dowolny stabilny klucz,
     * a identyfikatory sprzętowe są danymi, których nie musimy zbierać.
     */
    val deviceId: String = prefs.getString("deviceId", null) ?: run {
        val nowy = UUID.randomUUID().toString().take(8)
        prefs.edit { putString("deviceId", nowy) }
        nowy
    }

    private val _settings = MutableStateFlow(load())
    val settings: StateFlow<AppSettings> = _settings

    private fun load(): AppSettings = AppSettings(
        serverUrl = prefs.getString("serverUrl", AppSettings.DEFAULT_SERVER_URL) ?: AppSettings.DEFAULT_SERVER_URL,
        wakeLock = prefs.getBoolean("wakeLock", true),
        dropLog = prefs.getBoolean("dropLog", true),
        batteryAssist = prefs.getBoolean("batteryAssist", true),
    )

    val current: AppSettings get() = _settings.value

    fun update(transform: (AppSettings) -> AppSettings) {
        val next = transform(_settings.value)
        prefs.edit {
            putString("serverUrl", next.serverUrl)
            putBoolean("wakeLock", next.wakeLock)
            putBoolean("dropLog", next.dropLog)
            putBoolean("batteryAssist", next.batteryAssist)
        }
        _settings.value = next
    }
}
