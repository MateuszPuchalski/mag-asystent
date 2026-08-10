package pl.wertis.kolektor

import android.os.Bundle
import android.view.KeyEvent
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch
import pl.wertis.kolektor.scan.WedgeKeySource
import pl.wertis.kolektor.ui.AppRoot
import pl.wertis.kolektor.ui.theme.WertisTheme

class MainActivity : ComponentActivity() {

    /* Znacznik wejścia w tło. Trzymany W AKTYWNOŚCI, nie w grafie: dotyczy
       WIDOKU, a nie stanu aplikacji, i ma umrzeć razem z ekranem. */
    private var wTleOd: Long? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val graph = appGraph

        // wake lock: ekran nie gaśnie podczas pracy (przełącznik w Ustawieniach)
        lifecycleScope.launch {
            graph.settings.settings.collect {
                if (it.wakeLock) {
                    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                } else {
                    window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                }
            }
        }

        setContent {
            WertisTheme {
                AppRoot(graph)
            }
        }
    }

    override fun onResume() {
        super.onResume()
        appGraph.scanner.start(this)
        appGraph.motion.start()
        appGraph.batteryAssist.start()
        // Blokada sesji jest stanem SERWERA (plan §7) — po powrocie z tła
        // pytamy o nią, zamiast prowadzić drugi zegar po stronie kolektora.
        appGraph.session.refresh()

        /* POWRÓT NA EKRAN GŁÓWNY PO DŁUŻSZEJ PRZERWIE (0.38.0).
           Zgłoszenie z hali: karta towaru przetrwała dwudziestominutową
           przerwę, magazynier zeskanował etykietę półki, żeby sprawdzić jej
           zawartość — i zmienił lokalizację kartoteki, bo na karcie towaru
           skan półki znaczy dokładnie to. Powód progu i to, dlaczego nie
           „zawsze", stoi w `core/nav/PowrotDoPracy.kt`. */
        if (appGraph.nav.wrocNaGlownyPoPrzerwie(wTleOd)) {
            // ekran zmieniony bez udziału człowieka wygląda jak awaria,
            // dopóki nie powie się, dlaczego
            appGraph.effects.toast("Przerwa w pracy — wróciliśmy na ekran główny")
        }
        wTleOd = null
    }

    override fun onPause() {
        wTleOd = System.currentTimeMillis()
        appGraph.scanner.stop(this)
        appGraph.motion.stop()
        appGraph.batteryAssist.stop()
        super.onPause()
    }

    /** Keyboard wedge: skaner-klawiatura kończy Enterem — patrz WedgeKeySource. */
    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.action == KeyEvent.ACTION_DOWN && WedgeKeySource.onKeyDown(event)) return true
        return super.dispatchKeyEvent(event)
    }
}
