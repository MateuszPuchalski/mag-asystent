package pl.wertis.kolektor.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
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
import pl.wertis.kolektor.core.pin.Pin
import pl.wertis.kolektor.scan.ScannerBus
import pl.wertis.kolektor.ui.chrome.OfflineBanner
import pl.wertis.kolektor.ui.chrome.PinBar
import pl.wertis.kolektor.ui.chrome.SuccessOverlay
import pl.wertis.kolektor.ui.chrome.TabBar
import pl.wertis.kolektor.ui.chrome.ToastOverlay
import pl.wertis.kolektor.ui.chrome.TopBar
import pl.wertis.kolektor.ui.home.HomeScreen
import pl.wertis.kolektor.ui.location.LocationScreen
import pl.wertis.kolektor.ui.product.ProductScreen
import pl.wertis.kolektor.ui.delivery.DeliveryDocumentsScreen
import pl.wertis.kolektor.ui.delivery.DeliveryLinesScreen
import pl.wertis.kolektor.ui.problems.ProblemsBanner
import pl.wertis.kolektor.ui.problems.ProblemsScreen
import pl.wertis.kolektor.ui.putaway.PutawayDocumentsScreen
import pl.wertis.kolektor.ui.putaway.PutawaySessionScreen
import pl.wertis.kolektor.ui.queue.QueueScreen
import pl.wertis.kolektor.ui.scanloc.ScanLocScreen
import pl.wertis.kolektor.ui.settings.SettingsScreen
import pl.wertis.kolektor.ui.scan.globalScan
import pl.wertis.kolektor.ui.splash.SplashScreen

@Composable
fun AppRoot(graph: AppGraph) {
    val screen by graph.nav.screen.collectAsStateWithLifecycle()
    val users by graph.users.users.collectAsStateWithLifecycle()
    val queue by graph.queueRepo.queue.collectAsStateWithLifecycle()
    val toastMsg by graph.effects.toastMsg.collectAsStateWithLifecycle()
    val success by graph.effects.success.collectAsStateWithLifecycle()
    val offlineCount by graph.offlineQueue.count.collectAsStateWithLifecycle()
    val problems by graph.problemsRepo.problems.collectAsStateWithLifecycle()
    val pin by graph.pin.pin.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()

    // Globalny fallback skanów. Wszystko idzie przez `/scan/:code`, także kod
    // rozpoznany lokalnie jako lokalizacja — serwer jest właścicielem reguły
    // i on rozstrzyga, a kontekst przyklejony działa wtedy w jednym miejscu.
    DisposableEffect(graph) {
        ScannerBus.setFallback { scan ->
            scope.launch { globalScan(graph, scan.code) }
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
        // przypięcie zapisuje dane bez pytania, więc wisi NAD wszystkim innym
        pin?.let { p ->
            when (p) {
                is Pin.Loc -> PinBar(p.code, "skanuj towary — trafią na ten regał") { graph.pin.release() }
                is Pin.Tow -> PinBar(p.sym, "skanuj regał — towar tam trafi") { graph.pin.release() }
            }
        }
        OfflineBanner(offlineCount) {
            scope.launch { graph.offlineQueue.flush() }
        }
        // wyjątki wiszą przed oczami, dopóki ktoś ich nie zamknie (D8)
        if (screen != Screen.PROBLEMS) {
            ProblemsBanner(problems.size) { graph.nav.openProblems() }
        }
        Box(Modifier.weight(1f).fillMaxSize()) {
            when (screen) {
                Screen.HOME -> HomeScreen(graph)
                Screen.PRODUCT -> ProductScreen(graph)
                Screen.SCAN_LOC -> ScanLocScreen(graph)
                Screen.QUEUE -> QueueScreen(graph)
                Screen.DELIVERY_DOCS -> DeliveryDocumentsScreen(graph)
                Screen.DELIVERY_LINES -> DeliveryLinesScreen(graph)
                Screen.PUTAWAY_DOCS -> PutawayDocumentsScreen(graph)
                Screen.PUTAWAY_SESSION -> PutawaySessionScreen(graph)
                Screen.LOCATION -> LocationScreen(graph)
                Screen.SETTINGS -> SettingsScreen(graph)
                Screen.PROBLEMS -> ProblemsScreen(graph)
                Screen.SPLASH -> {}
            }
            ToastOverlay(toastMsg)
            SuccessOverlay(success)
        }
        TabBar(
            screen = screen,
            onHome = { graph.nav.go(Screen.HOME) },
            onPutaway = { graph.nav.go(Screen.DELIVERY_DOCS) },
        )
    }
}
