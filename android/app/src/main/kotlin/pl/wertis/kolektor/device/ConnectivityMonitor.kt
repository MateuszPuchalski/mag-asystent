package pl.wertis.kolektor.device

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.LinkProperties
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import java.net.Inet4Address
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/**
 * Czym kolektor stoi w sieci w tej chwili — na ekran diagnostyki.
 *
 * Same fakty, bez ocen: ocenę składa ekran, bo to on zna adres serwera.
 * `null` wszędzie znaczy „system tego nie podał" i tak ma być pokazane.
 */
data class OpisDrogi(
    /** „Wi-Fi", „komórkowa", „ethernet", „inna" albo `null` przy braku sieci. */
    val rodzaj: String?,
    /** Adres IPv4 urządzenia — ten, który porównuje się z adresem serwera. */
    val adres: String?,
    /** Nazwa interfejsu (`wlan0`) — mówi, czy ruch naprawdę idzie Wi-Fi. */
    val interfejs: String?,
    /** Serwery DNS sieci; puste, gdy serwer podany adresem IP i tak ich nie użyje. */
    val dns: List<String>,
)

/* ── Stan sieci ──────────────────────────────────────────────────────────────
   Odpowiednik navigator.onLine plus dwa zdarzenia, i one są tu ważniejsze niż
   samo `online`.

   `onAvailable` — sieć wróciła; podpięty jest do niego flush bufora offline.

   `onZmianaSieci` — pod nogami ZMIENIŁA SIĘ droga do serwera, choć sieć cały
   czas jest. Tak wygląda przejście między punktami dostępowymi w hali: gniazda
   otwarte do poprzedniego AP zostają w puli OkHttp jako połączenia z pozoru
   żywe, więc kolejne żądanie czeka na timeout zamiast otworzyć nowe. Objaw
   z hali brzmiał „nie mogę się połączyć, wystarczyło rozłączyć i połączyć
   Wi-Fi" — bo ręczne rozłączenie robiło dokładnie to, czego brakowało tutaj. */

class ConnectivityMonitor(context: Context) {
    private val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager

    private val _online = MutableStateFlow(currentlyOnline())
    val online: StateFlow<Boolean> = _online

    val isOnline: Boolean get() = _online.value

    /** Wywoływane po odzyskaniu sieci — podpinane do flusha bufora. */
    var onAvailable: (() -> Unit)? = null

    /**
     * Wywoływane, gdy droga do serwera mogła się zmienić.
     *
     * Szersze niż `onAvailable` z rozmysłem: przy przeskoku między punktami
     * dostępowymi tej samej sieci Android często NIE zgłasza nowej sieci,
     * zmieniają się tylko jej adresy (`onLinkPropertiesChanged`).
     */
    var onZmianaSieci: (() -> Unit)? = null

    init {
        cm.registerNetworkCallback(
            NetworkRequest.Builder()
                .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                .build(),
            object : ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: Network) {
                    _online.value = true
                    onZmianaSieci?.invoke()
                    onAvailable?.invoke()
                }

                override fun onLost(network: Network) {
                    _online.value = currentlyOnline()
                    onZmianaSieci?.invoke()
                }

                override fun onLinkPropertiesChanged(network: Network, props: LinkProperties) {
                    // zmiana adresu bez zmiany sieci — czyli przeskok AP w hali
                    onZmianaSieci?.invoke()
                }
            },
        )
    }

    /**
     * Opis bieżącej drogi do serwera. Czytany na żądanie, nie trzymany:
     * ekran diagnostyki pyta o niego przy każdym odświeżeniu, a wartość
     * zapamiętana byłaby starsza niż to, co człowiek właśnie sprawdza.
     *
     * Wszystko bierze się z `ConnectivityManager`, czyli z uprawnienia, które
     * aplikacja i tak ma (`ACCESS_NETWORK_STATE`). Nazwa sieci Wi-Fi (SSID)
     * i punkt dostępowy (BSSID) zostają POZA ekranem, bo od Androida 8 wymagają
     * uprawnienia do lokalizacji. Pytanie magazyniera w alejce o zgodę na
     * lokalizację kosztowałoby więcej niż niesie odpowiedź.
     */
    fun opisDrogi(): OpisDrogi {
        val siec = cm.activeNetwork ?: return OpisDrogi(null, null, null, emptyList())
        val caps = cm.getNetworkCapabilities(siec)
        val rodzaj = when {
            caps == null -> null
            caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "Wi-Fi"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "komórkowa"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "ethernet"
            else -> "inna"
        }
        val props = cm.getLinkProperties(siec)
        /* WYŁĄCZNIE IPv4: adres serwera w hali jest czwórką liczb, a lista
           z adresem `fe80::…` na górze kazałaby porównywać rzeczy nieporównywalne. */
        val adres = props?.linkAddresses
            ?.firstOrNull { it.address is Inet4Address }?.address?.hostAddress
        return OpisDrogi(
            rodzaj = rodzaj,
            adres = adres,
            interfejs = props?.interfaceName,
            dns = props?.dnsServers?.mapNotNull { it.hostAddress } ?: emptyList(),
        )
    }

    private fun currentlyOnline(): Boolean {
        val caps = cm.getNetworkCapabilities(cm.activeNetwork) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }
}
