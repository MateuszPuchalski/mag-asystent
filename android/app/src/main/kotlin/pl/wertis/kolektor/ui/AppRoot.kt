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
import pl.wertis.kolektor.core.session.SessionState
import pl.wertis.kolektor.core.session.osoba
import pl.wertis.kolektor.scan.ScannerBus
import pl.wertis.kolektor.ui.chrome.OfflineBanner
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
import pl.wertis.kolektor.ui.session.HandoverDialog
import pl.wertis.kolektor.ui.session.LockOverlay
import pl.wertis.kolektor.ui.splash.SplashScreen

@Composable
fun AppRoot(graph: AppGraph) {
    val screen by graph.nav.screen.collectAsStateWithLifecycle()
    val stan by graph.session.state.collectAsStateWithLifecycle()
    val pytanie by graph.session.pytanie.collectAsStateWithLifecycle()
    val queue by graph.queueRepo.queue.collectAsStateWithLifecycle()
    val toastMsg by graph.effects.toastMsg.collectAsStateWithLifecycle()
    val success by graph.effects.success.collectAsStateWithLifecycle()
    val offlineCount by graph.offlineQueue.count.collectAsStateWithLifecycle()
    val problems by graph.problemsRepo.problems.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()

    // Globalny fallback skanów — łapie to, czego OTWARTY EKRAN nie przechwycił.
    // Kolejność jest tu całą regułą kontekstu: karta towaru bierze skan półki
    // dla siebie, a dopiero skan z ekranu, który się nim nie zainteresował,
    // trafia tutaj. Wszystko idzie przez `/scan/:code`, także kod rozpoznany
    // lokalnie jako lokalizacja — właścicielem reguły jest serwer.
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

    if (screen == Screen.SPLASH || stan is SessionState.Brak) {
        SplashScreen(graph)
        return
    }

    Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        TopBar(
            screen = screen,
            hasBack = graph.nav.backTargetOf(screen) != null,
            user = stan.osoba ?: "?",
            summary = queue?.summary,
            onBack = { graph.nav.goBack() },
            onOpenQueue = { graph.nav.openQueue() },
            onOpenSettings = { graph.nav.openSettings() },
        )
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
            /* Blokada NIE zdejmuje ekranu spod spodu — otwarta dostawa ma być
               widoczna, bo to ona jest dowodem, że nic nie zginęło. Skaner
               działa dalej: badge to jedyny sposób na zdjęcie blokady. */
            if (stan is SessionState.Zablokowana) {
                LockOverlay(stan.osoba ?: "")
            }
            pytanie?.let { p ->
                HandoverDialog(
                    pytanie = p,
                    kontekst = graph.nav.opisPracy(),
                    onPotwierdz = {
                        scope.launch {
                            graph.session.przejmij(graph.nav.opisPracy())?.let { graph.effects.toast(it) }
                        }
                    },
                    onOdrzuc = { graph.session.odrzucPrzejecie() },
                )
            }
        }
        TabBar(
            screen = screen,
            onHome = { graph.nav.go(Screen.HOME) },
            onPutaway = { graph.nav.go(Screen.DELIVERY_DOCS) },
        )
    }
}
