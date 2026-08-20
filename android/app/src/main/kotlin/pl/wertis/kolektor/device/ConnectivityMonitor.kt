package pl.wertis.kolektor.device

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.LinkProperties
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

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

    private fun currentlyOnline(): Boolean {
        val caps = cm.getNetworkCapabilities(cm.activeNetwork) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }
}
