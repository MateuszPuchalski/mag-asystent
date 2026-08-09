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
import androidx.compose.runtime.produceState
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.launch
import pl.wertis.kolektor.AppGraph
import pl.wertis.kolektor.BuildConfig
import pl.wertis.kolektor.net.apiCall
import pl.wertis.kolektor.core.nav.Screen
import pl.wertis.kolektor.core.session.SessionState
import pl.wertis.kolektor.core.session.osoba
import pl.wertis.kolektor.scan.ScannerBus
import androidx.compose.runtime.LaunchedEffect
import pl.wertis.kolektor.ui.chrome.BateriaBanner
import pl.wertis.kolektor.ui.chrome.OfflineBanner
import pl.wertis.kolektor.ui.chrome.SerwerBanner
import pl.wertis.kolektor.ui.chrome.SuccessOverlay
import pl.wertis.kolektor.ui.chrome.TabBar
import pl.wertis.kolektor.ui.chrome.ToastOverlay
import pl.wertis.kolektor.ui.chrome.TopBar
import pl.wertis.kolektor.ui.chrome.WersjaBar
import pl.wertis.kolektor.ui.home.HomeScreen
import pl.wertis.kolektor.ui.location.LocationScreen
import pl.wertis.kolektor.ui.product.ProductScreen
import pl.wertis.kolektor.ui.delivery.DeliveryDocumentsScreen
import pl.wertis.kolektor.ui.delivery.DeliveryLinesScreen
import pl.wertis.kolektor.ui.problems.ProblemsBanner
import pl.wertis.kolektor.ui.problems.ProblemsScreen
import pl.wertis.kolektor.ui.queue.QueueScreen
import pl.wertis.kolektor.ui.scanloc.ScanLocScreen
import pl.wertis.kolektor.ui.settings.SettingsScreen
import pl.wertis.kolektor.ui.scan.globalScan
import pl.wertis.kolektor.ui.setup.SetupScreen
import pl.wertis.kolektor.ui.splash.SplashScreen

@Composable
fun AppRoot(graph: AppGraph) {
    val screen by graph.nav.screen.collectAsStateWithLifecycle()
    val stan by graph.session.state.collectAsStateWithLifecycle()
    val queue by graph.queueRepo.queue.collectAsStateWithLifecycle()
    val toastMsg by graph.effects.toastMsg.collectAsStateWithLifecycle()
    val success by graph.effects.success.collectAsStateWithLifecycle()
    val offlineCount by graph.offlineQueue.count.collectAsStateWithLifecycle()
    val serwerMilczy by graph.queueRepo.serwerMilczy.collectAsStateWithLifecycle()
    val online by graph.connectivity.online.collectAsStateWithLifecycle()
    val niskaBateria by graph.batteryAssist.niska.collectAsStateWithLifecycle()

    /* Raz na proces: kolektor ze ściszonym dźwiękiem daje tylko wibrację,
       a w rękawicy na wózku bywa jej za mało. Powiedziane przy starcie,
       nie przy każdym beepie — ściszenie bywa świadome (narada, telefon). */
    LaunchedEffect(Unit) {
        if (graph.feedback.scichniety()) {
            graph.effects.toast("Kolektor jest ściszony — sygnały skanera będą tylko wibracją")
        }
    }
    val problems by graph.problemsRepo.problems.collectAsStateWithLifecycle()
    val ustawienia by graph.settings.settings.collectAsStateWithLifecycle()
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

    /* Wersja serwera — raz na start aplikacji i po każdej zmianie adresu.
       Nie w pętli: numer zmienia się przy restarcie usługi, nie co sekundę,
       a pasek na dole ekranu nie jest powodem do ruchu w sieci. */
    val wersjaSerwera by produceState<String?>(null, ustawienia.serverUrl) {
        value = try {
            apiCall { graph.api.health() }.wersja
        } catch (_: Exception) {
            null
        }
    }

    BackHandler(enabled = screen != Screen.SPLASH && screen != Screen.HOME) {
        graph.nav.goBack()
    }

    // Kreator kont MUSI wyprzedzać bramkę sesji: przy pustej instalacji sesji
    // jeszcze nie ma i nie ma jak jej zdobyć, dopóki nie powstanie pierwsze konto.
    if (screen == Screen.SETUP) {
        SetupScreen(graph)
        return
    }
    if (screen == Screen.SPLASH || stan is SessionState.Brak) {
        /* Pasek wersji także TUTAJ, i to nie dla porządku: ekran startowy jest
           miejscem, w którym najczęściej pyta się „co ten kolektor ma w środku"
           — przy „nie widzę serwera" i przy pierwszym uruchomieniu. */
        Column(Modifier.fillMaxSize()) {
            Box(Modifier.weight(1f)) { SplashScreen(graph) }
            WersjaBar(BuildConfig.VERSION_NAME, wersjaSerwera)
        }
        return
    }

    Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        TopBar(
            screen = screen,
            // ten sam ekran, dwie intencje — nagłówek nie może kłamać
            titleOverride = "DODANIE LOKALIZACJI"
                .takeIf { screen == Screen.SCAN_LOC && graph.nav.scanLocDodaj },
            user = stan.osoba ?: "?",
            summary = queue?.summary,
            onOpenQueue = { graph.nav.openQueue() },
            onOpenSettings = { graph.nav.openSettings() },
        )
        /* Tylko przy działającej sieci: bez niej to urządzenie jest odcięte,
           nie serwer — i wtedy mówi bufor offline, nie ten baner. */
        SerwerBanner(serwerMilczy && online)
        BateriaBanner(niskaBateria)
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
                Screen.LOCATION -> LocationScreen(graph)
                Screen.SETTINGS -> SettingsScreen(graph)
                Screen.PROBLEMS -> ProblemsScreen(graph)
                Screen.SPLASH -> {}
                Screen.SETUP -> {}
            }
            ToastOverlay(toastMsg)
            SuccessOverlay(success)
        }
        // WSTECZ zeszło tu z lewego górnego rogu — kciuk go tam nie dosięgał
        TabBar(
            screen = screen,
            hasBack = graph.nav.backTargetOf(screen) != null,
            onHome = { graph.nav.go(Screen.HOME) },
            onPutaway = { graph.nav.go(Screen.DELIVERY_DOCS) },
            onBack = { graph.nav.goBack() },
        )
        WersjaBar(BuildConfig.VERSION_NAME, wersjaSerwera)
    }
}
