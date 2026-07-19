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
    }

    override fun onPause() {
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
