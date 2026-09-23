package pl.wertis.kolektor.core.kolektor

import java.time.Instant
import pl.wertis.kolektor.core.net.KolektorView
import pl.wertis.kolektor.core.net.WezwanieKolektora

/* ── Szukanie zgubionego kolektora — reguły bez Androida ────────────────────
   Serwer trzyma wezwanie, kolektor sam o nie pyta (nagłówek
   `services/szukanie-kolektora.ts`). Tu stoją decyzje, które zasługują na
   test, a ekran i syrena zostają w `:app` z samym rysowaniem i dźwiękiem. */

/**
 * Krótki znak urządzenia, np. `#A3F9` — ta sama reguła co
 * `etykietaUrzadzenia` na serwerze.
 *
 * Obie MUSZĄ dawać ten sam napis. Człowiek porównuje znak z listy na cudzym
 * kolektorze albo w panelu z tym, który widzi w Ustawieniach swojego.
 */
fun etykietaKolektora(deviceId: String): String {
    val znaki = deviceId.filter { it.isLetterOrDigit() && it.code < 128 }.uppercase()
    return "#" + znaki.takeLast(4).ifEmpty { "????" }
}

/**
 * Kolektory do wyboru na liście — bez tego, z którego się szuka.
 *
 * Własny wiersz byłby jedynym, którego wezwanie nic nie daje: syrena
 * zagrałaby w ręku szukającego. Kolejność zostaje z serwera, czyli najświeżej
 * widziane na górze, bo zgubiony kolektor zwykle był używany niedawno.
 */
fun doWyboru(lista: List<KolektorView>, ten: String?): List<KolektorView> =
    lista.filter { it.deviceId != ten }

/**
 * Stan kolektora jednym zdaniem — czy warto iść nasłuchiwać.
 *
 * Kolejność warunków jest decyzją: trwające wezwanie mówi więcej niż sam
 * odzew, a wylogowany kolektor nie zadzwoni, choćby niedawno pytał.
 */
fun opisKolektora(k: KolektorView): String {
    val w = k.wezwanie
    return when {
        w != null && w.odebrane -> "DZWONI · wezwał(a) ${w.przez}"
        w != null -> "czeka, aż kolektor zapyta (do 10 s)"
        !k.zalogowany -> "wylogowany — nie zadzwoni"
        k.slucha -> "słucha — zadzwoni od razu"
        else -> "cisza — uśpiony albo bez baterii"
    }
}

/**
 * Czy ten kolektor ma teraz dzwonić.
 *
 * `wyciszone` to znacznik wezwania (`od`), które człowiek zgasił ZNALAZŁEM.
 * Bez niego nieudane zgłoszenie odnalezienia — Wi-Fi przy metalowym regale —
 * włączyłoby syrenę z powrotem przy następnym pytaniu, w ręku kogoś, kto
 * kolektor właśnie podniósł. Nowe wezwanie ma inny znacznik i dzwoni.
 */
fun maDzwonic(w: WezwanieKolektora?, wyciszone: String?): Boolean = w != null && w.od != wyciszone

/**
 * Czy wezwanie minęło według WŁASNEGO zegara kolektora.
 *
 * Potrzebne wyłącznie bez sieci: kolektor, który stracił Wi-Fi w trakcie
 * dzwonienia, nie dowie się od serwera, że czas minął, i grałby do padnięcia
 * baterii. Nieczytelna data znaczy „nie wiem" i nie przerywa syreny — cisza
 * przy szukanym kolektorze jest gorsza niż hałas o minutę za długi.
 */
fun wygaslo(w: WezwanieKolektora, terazMs: Long): Boolean =
    runCatching { Instant.parse(w.doKiedy).toEpochMilli() <= terazMs }.getOrDefault(false)
