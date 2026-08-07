package pl.wertis.kolektor.core.net

import kotlinx.serialization.Serializable

/* ── Kod parowania: `wertis://host[:port]` ──────────────────────────────────
   LUSTRO `server/src/services/parowanie.ts`. Obie strony muszą przyjmować
   dokładnie ten sam zbiór kodów — serwer generuje, kolektor czyta, a rozjazd
   znaczy kod QR wydrukowany i powieszony przy ładowarce, którego nikt nie
   umie zeskanować.

   REGUŁA JEST WYPISANA WPROST, a nie zlecona `Uri.parse`. Parsery URI różnią
   się między platformami akurat na wejściu, które chcemy odrzucić: `Uri`
   Androida połknie ścieżkę, dane logowania i spację w hoście, po czym zwróci
   host, którego nikt nie zamierzał wpisać. Tu wolno przejść wyłącznie temu,
   co naprawdę jest adresem serwera.                                          */

const val SCHEMAT_PAROWANIA = "wertis://"

/** Port API, gdy kod go nie podaje — ta sama domyślna, co w `config.ts`. */
const val PORT_DOMYSLNY = 3001

private val HOST_PORT = Regex("""^([a-zA-Z0-9.-]+)(?::(\d{1,5}))?$""")

/**
 * Kod parowania → adres HTTP; `null`, gdy to nie jest kod parowania.
 *
 * Zwraca `null` NA WSZYSTKO INNE i to jest istotne dla ekranu startowego:
 * skaner na tym ekranie zbiera znaki także wtedy, gdy ktoś zacznie pisać
 * hasło. Cokolwiek nie jest kodem parowania, ma tu zniknąć bez śladu —
 * nie trafić do logu, nie polecieć na serwer, nie pokazać się w komunikacie.
 */
fun parsujKodParowania(kod: String): String? {
    val t = kod.trim()
    if (!t.startsWith(SCHEMAT_PAROWANIA, ignoreCase = true)) return null
    val reszta = t.substring(SCHEMAT_PAROWANIA.length)

    val m = HOST_PORT.matchEntire(reszta) ?: return null
    val host = m.groupValues[1]
    val port = m.groupValues[2].takeIf { it.isNotEmpty() }?.toIntOrNull() ?: PORT_DOMYSLNY
    if (port !in 1..65535) return null
    if (host.length > 253 || host.endsWith(".")) return null

    return "http://$host:$port"
}

/** Czy tekst w ogóle wygląda na kod parowania — do rozpoznania skanu. */
fun czyKodParowania(kod: String): Boolean =
    kod.trim().startsWith(SCHEMAT_PAROWANIA, ignoreCase = true)

/**
 * Adres serwera do POKAZANIA CZŁOWIEKOWI przed związaniem się z nim.
 *
 * Bez TLS-a nic nie odróżnia odpowiedzi serwera od odpowiedzi cudzego
 * urządzenia w tej samej sieci, więc ostatnim sprawdzeniem jest wzrok
 * magazyniera — a ten potrzebuje adresu, nie URL-a z protokołem i portem
 * sklejonych w jedną linijkę petitem.
 */
fun opisAdresu(url: String): String = url.removePrefix("http://").removePrefix("https://")

/* ── Odpowiedź na rozgłoszenie „gdzie jest serwer WERTIS?" ─────────────────
   Gniazdo UDP siedzi w module aplikacji (`net/Odkrywanie.kt`), bo potrzebuje
   Androida. TREŚĆ odpowiedzi rozbieramy tutaj — to czysta logika, a zarazem
   jedyne miejsce, w którym kolektor bierze do ręki dane WPROST Z SIECI, od
   kogokolwiek, kto zdążył odpowiedzieć. Właśnie takie miejsce ma test.       */

@Serializable
data class OdpowiedzOdkrywania(
    val wertis: Int = 0,
    val adres: String? = null,
    val wersja: String? = null,
)

/** Serwer znaleziony w sieci — do pokazania człowiekowi, nie do użycia wprost. */
data class ZnalezionySerwer(
    /** Gotowy adres HTTP, np. `http://192.168.1.50:3001`. */
    val url: String,
    /** Wersja serwera; `null`, gdy odpowiedź jej nie niosła. */
    val wersja: String?,
)

/**
 * Treść odpowiedzi → wpis na liście; `null`, gdy to nie jest nasza odpowiedź.
 *
 * Adres przechodzi przez `parsujKodParowania`, czyli przez TĘ SAMĄ regułę, co
 * kod QR. Bez tego pole `adres` byłoby dowolnym napisem z sieci ustawionym
 * jako adres API — czyli żądaniami z tokenem sesji wysyłanymi tam, gdzie każe
 * pierwszy, kto odpowie na rozgłoszenie.
 */
fun zinterpretujOdpowiedz(tresc: String): ZnalezionySerwer? {
    val body = runCatching {
        WertisJson.decodeFromString(OdpowiedzOdkrywania.serializer(), tresc)
    }.getOrNull() ?: return null
    if (body.wertis != 1) return null
    val url = body.adres?.let { parsujKodParowania(it) } ?: return null
    return ZnalezionySerwer(url, body.wersja)
}
