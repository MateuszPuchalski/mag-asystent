package pl.wertis.kolektor.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.weight
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.launch
import pl.wertis.kolektor.AppGraph
import pl.wertis.kolektor.core.nav.Screen
import pl.wertis.kolektor.core.net.ScanResult
import pl.wertis.kolektor.core.scan.ScanKind
import pl.wertis.kolektor.data.RecentEntry
import pl.wertis.kolektor.net.apiCall
import pl.wertis.kolektor.scan.ScannerBus
import pl.wertis.kolektor.ui.chrome.OfflineBanner
import pl.wertis.kolektor.ui.chrome.SuccessOverlay
import pl.wertis.kolektor.ui.chrome.TabBar
import pl.wertis.kolektor.ui.chrome.ToastOverlay
import pl.wertis.kolektor.ui.chrome.TopBar
import pl.wertis.kolektor.ui.chrome.UndoBar
import pl.wertis.kolektor.ui.home.HomeScreen
import pl.wertis.kolektor.ui.location.LocationScreen
import pl.wertis.kolektor.ui.mm.MMScreen
import pl.wertis.kolektor.ui.product.ProductScreen
import pl.wertis.kolektor.ui.putaway.PutawayDocumentsScreen
import pl.wertis.kolektor.ui.putaway.PutawaySessionScreen
import pl.wertis.kolektor.ui.queue.QueueScreen
import pl.wertis.kolektor.ui.scanloc.ScanLocScreen
import pl.wertis.kolektor.ui.settings.SettingsScreen
import pl.wertis.kolektor.ui.splash.SplashScreen

@Composable
fun AppRoot(graph: AppGraph) {
    val screen by graph.nav.screen.collectAsStateWithLifecycle()
    val users by graph.users.users.collectAsStateWithLifecycle()
    val queue by graph.queueRepo.queue.collectAsStateWithLifecycle()
    val toastMsg by graph.effects.toastMsg.collectAsStateWithLifecycle()
    val success by graph.effects.success.collectAsStateWithLifecycle()
    val undoInfo by graph.effects.undo.collectAsStateWithLifecycle()
    val offlineCount by graph.offlineQueue.count.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()

    // globalny fallback skanów: LOC → zawartość lokalizacji; reszta → /scan/:code
    DisposableEffect(graph) {
        ScannerBus.setFallback { scan ->
            when (scan.kind) {
                ScanKind.LOC -> {
                    graph.feedback.beep(true)
                    graph.nav.openLocation(scan.code)
                }
                else -> scope.launch { globalScan(graph, scan.code) }
            }
            true
        }
        onDispose { ScannerBus.setFallback(null) }
    }

    BackHandler(enabled = screen != Screen.SPLASH && screen != Screen.HOME) {
        graph.nav.goBack()
    }

    if (screen == Screen.SPLASH) {
        SplashScreen(graph)
        return
    }

    Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        TopBar(
            screen = screen,
            hasBack = graph.nav.backTargetOf(screen) != null,
            user = users.current,
            summary = queue?.summary,
            onBack = { graph.nav.goBack() },
            onOpenQueue = { graph.nav.openQueue() },
            onOpenSettings = { graph.nav.openSettings() },
        )
        OfflineBanner(offlineCount) {
            scope.launch { graph.offlineQueue.flush() }
        }
        Box(Modifier.weight(1f).fillMaxSize()) {
            when (screen) {
                Screen.HOME -> HomeScreen(graph)
                Screen.PRODUCT -> ProductScreen(graph)
                Screen.SCAN_LOC -> ScanLocScreen(graph)
                Screen.MM -> MMScreen(graph)
                Screen.QUEUE -> QueueScreen(graph)
                Screen.PUTAWAY_DOCS -> PutawayDocumentsScreen(graph)
                Screen.PUTAWAY_SESSION -> PutawaySessionScreen(graph)
                Screen.LOCATION -> LocationScreen(graph)
                Screen.SETTINGS -> SettingsScreen(graph)
                Screen.SPLASH -> {}
            }
            ToastOverlay(toastMsg)
            SuccessOverlay(success)
            UndoBar(undoInfo) {
                scope.launch { graph.undo.performUndo() }
            }
        }
        TabBar(
            screen = screen,
            onHome = { graph.nav.go(Screen.HOME) },
            onPutaway = { graph.nav.go(Screen.PUTAWAY_DOCS) },
        )
    }
}

/** Fallback EAN/tekst: GET /scan/:code → karta / wyniki / nieznany kod. */
private suspend fun globalScan(graph: AppGraph, code: String) {
    try {
        when (val r = apiCall { graph.api.scan(code) }) {
            is ScanResult.Product -> {
                graph.feedback.beep(true)
                graph.nav.openProduct(
                    r.card.id,
                    RecentEntry(r.card.id, r.card.sym, r.card.locs.firstOrNull() ?: ""),
                )
            }
            is ScanResult.Search -> {
                graph.feedback.beep(true)
                graph.nav.pendingSearch = code
                graph.nav.go(Screen.HOME)
            }
            is ScanResult.NotFound -> {
                graph.feedback.beep(false)
                graph.effects.toast("Nieznany kod: ${r.code}")
            }
        }
    } catch (_: Exception) {
        graph.feedback.beep(false)
        graph.effects.toast("Błąd połączenia z serwerem")
    }
}
