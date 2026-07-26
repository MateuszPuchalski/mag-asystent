package pl.wertis.kolektor.ui.splash

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.launch
import pl.wertis.kolektor.AppGraph
import pl.wertis.kolektor.BuildConfig
import pl.wertis.kolektor.core.session.SessionState
import pl.wertis.kolektor.ui.components.PrimaryButton
import pl.wertis.kolektor.ui.components.WertisTextField
import pl.wertis.kolektor.ui.theme.Amber
import pl.wertis.kolektor.ui.theme.BarlowCond
import pl.wertis.kolektor.ui.theme.Ink
import pl.wertis.kolektor.ui.theme.InkMute
import pl.wertis.kolektor.ui.theme.Paper

/* ── Splash: „Zeskanuj swój badge" (plan §7) ────────────────────────────────
   Dotąd stała tu lista imion wpisanych z klawiatury i wysyłanych w nagłówku
   `X-User`. Każdy mógł wybrać dowolne, a `events` zbierał warianty tej samej
   osoby, więc audyt nadawał się do czytania oczami i do niczego więcej.

   Teraz jeden skan, ~1 s, bez PIN-u. Pole tekstowe zostaje WYŁĄCZNIE na
   wypadek uszkodzonej etykiety — kod przepisuje się wtedy z plakietki i tak
   samo przechodzi przez cyfrę kontrolną, więc literówka jest odrzucana,
   a nie zapisywana jako cudza tożsamość.                                     */

@Composable
fun SplashScreen(graph: AppGraph) {
    val stan by graph.session.state.collectAsStateWithLifecycle()
    var reczny by remember { mutableStateOf("") }
    var blad by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    // Sesja może już istnieć (kolektor wrócił z kieszeni, proces był ubity) —
    // wtedy Splash nie ma o co pytać i schodzi z drogi. W efekcie, nie w ciele
    // kompozycji: nawigacja z rysowania to pętla rekompozycji.
    LaunchedEffect(stan) {
        if (stan !is SessionState.Brak) graph.nav.start()
    }

    fun sprobuj(kod: String) {
        if (kod.isBlank()) return
        scope.launch {
            val msg = graph.session.onBadge(kod)
            if (graph.session.hasSession) {
                graph.feedback.beep(true)
                graph.nav.start()
            } else {
                graph.feedback.beep(false)
                blad = msg ?: "Nie rozpoznano badge'a"
            }
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Paper)
            .padding(20.dp)
            .verticalScroll(rememberScrollState()),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.height(40.dp))
        Text(
            "WERTIS",
            fontFamily = BarlowCond,
            fontWeight = FontWeight.ExtraBold,
            fontSize = 40.sp,
            color = Amber,
        )
        Text("Asystent magazyniera", fontSize = 14.sp, color = InkMute)
        Spacer(Modifier.height(28.dp))
        Text(
            "Zeskanuj swój badge",
            fontFamily = BarlowCond,
            fontWeight = FontWeight.Bold,
            fontSize = 22.sp,
            color = Ink,
        )
        Spacer(Modifier.height(8.dp))
        Text(
            "Skan plakietki loguje i podpisuje każdą operację.",
            fontSize = 13.sp,
            color = InkMute,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(24.dp))

        blad?.let {
            Text(it, fontSize = 14.sp, color = Amber, textAlign = TextAlign.Center)
            Spacer(Modifier.height(12.dp))
        }

        // ostatnia deska ratunku przy zdartej etykiecie — cyfra kontrolna
        // pilnuje, żeby literówka nie stała się cudzą tożsamością
        WertisTextField(
            value = reczny,
            onValueChange = { reczny = it; blad = null },
            placeholder = "…albo przepisz kod z plakietki",
            onDone = { sprobuj(reczny) },
        )
        Spacer(Modifier.height(8.dp))
        PrimaryButton(
            "ZALOGUJ",
            modifier = Modifier.fillMaxWidth(),
            enabled = reczny.isNotBlank(),
        ) { sprobuj(reczny) }

        Spacer(Modifier.weight(1f))
        Text("wersja ${BuildConfig.VERSION_NAME}", fontSize = 11.sp, color = InkMute)
    }
}
