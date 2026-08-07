package pl.wertis.kolektor.data

import android.content.Context
import android.content.RestrictionsManager
import androidx.core.content.getSystemService
import pl.wertis.kolektor.core.net.parsujKodParowania

/* ── Adres serwera podany przez MDM ─────────────────────────────────────────
   Kolektory i tak jadą przez MDM (SOTI / Zebra / Honeywell — DEPLOY.md §5),
   więc konsola, która wgrywa APK, może przy okazji wgrać adres serwera. To
   jedyna droga, przy której świeżo wyczyszczone urządzenie wstaje OD RAZU
   skonfigurowane: bez skanowania kodu, bez rozgłoszenia, bez człowieka.

   Klucz `serverUrl` w `res/xml/app_restrictions.xml`. Administrator widzi go
   w konsoli MDM jako pole tekstowe aplikacji.

   MA PIERWSZEŃSTWO NAD WSZYSTKIM i nie wymaga potwierdzenia — w odróżnieniu
   od rozgłoszenia UDP, którego treść pochodzi z sieci. Konfiguracja zarządzana
   przychodzi od właściciela urządzenia przez kanał MDM-a, czyli od tej samej
   osoby, która zdecydowała, jaka aplikacja w ogóle na tym sprzęcie stoi.
   Pytanie jej o potwierdzenie tego, co przed chwilą sama wpisała w konsoli,
   nie dodawałoby niczego poza jednym ekranem do przeklikania na każdym
   z kolektorów.                                                              */

private const val KLUCZ_ADRES = "serverUrl"

/**
 * Adres serwera z konfiguracji zarządzanej; `null`, gdy MDM go nie podał.
 *
 * Przyjmowany jest zarówno gotowy `http://…`, jak i kod parowania
 * `wertis://…` — administrator wpisujący go z wydruku ze strony `/parowanie`
 * nie ma powodu przepisywać tego na inny zapis, a odrzucenie takiej wartości
 * wyglądałoby jak „MDM nie działa".
 */
fun adresZMdm(context: Context): String? {
    val rm = context.getSystemService<RestrictionsManager>() ?: return null
    val wartosc = runCatching { rm.applicationRestrictions?.getString(KLUCZ_ADRES) }
        .getOrNull()
        ?.trim()
        ?.takeIf { it.isNotEmpty() }
        ?: return null

    parsujKodParowania(wartosc)?.let { return it }

    /* Zwykły adres HTTP z konsoli MDM. Sprawdzamy go tak samo wąsko jak kod
       parowania — pole tekstowe w konsoli przyjmie literówkę bez mrugnięcia,
       a adres z ogonem („http://10.0.0.5:3001/api") skończyłby się żądaniami
       pod `/api/api/...` i ekranem „nie widzę serwera" bez wskazówki. */
    val m = Regex("""^https?://([a-zA-Z0-9.-]+)(?::(\d{1,5}))?/?$""").matchEntire(wartosc)
        ?: return null
    val port = m.groupValues[2].takeIf { it.isNotEmpty() }?.toIntOrNull() ?: 3001
    if (port !in 1..65535) return null
    return "http://${m.groupValues[1]}:$port"
}
