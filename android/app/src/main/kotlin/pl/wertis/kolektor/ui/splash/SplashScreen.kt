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
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.launch
import pl.wertis.kolektor.AppGraph
import pl.wertis.kolektor.BuildConfig
import pl.wertis.kolektor.core.session.SessionState
import pl.wertis.kolektor.data.AppSettings
import pl.wertis.kolektor.scan.WedgeKeySource
import pl.wertis.kolektor.ui.components.OutlineButton
import pl.wertis.kolektor.ui.components.PrimaryButton
import pl.wertis.kolektor.ui.components.WertisTextField
import pl.wertis.kolektor.ui.settings.saveServerUrl
import pl.wertis.kolektor.ui.theme.Amber
import pl.wertis.kolektor.ui.theme.BarlowCond
import pl.wertis.kolektor.ui.theme.Ink
import pl.wertis.kolektor.ui.theme.InkMute
import pl.wertis.kolektor.ui.theme.Paper

/* ── Splash: logowanie (plan §7) ────────────────────────────────────────────
   Dotąd stała tu lista imion wpisanych z klawiatury i wysyłanych w nagłówku
   `X-User`. Każdy mógł wybrać dowolne, a `events` zbierał warianty tej samej
   osoby, więc audyt nadawał się do czytania oczami i do niczego więcej.
   Potem był skan plakietki — jedna sekunda, ale własny wzorzec w firmie,
   która wszędzie indziej loguje się loginem i hasłem.

   Login wstawiamy z pamięci, hasła NIGDY. Zapamiętane hasło byłoby plakietką
   pod inną nazwą, tylko bez możliwości świadomego oddania jej komuś.

   SKANER JEST TU WYŁĄCZONY. Na tym ekranie nie ma czego skanować, a wedge
   zbiera znaki z klawiatury sprzętowej globalnie — bez tego jedno spóźnione
   zdarzenie fokusu wystarczyłoby, żeby wpisywane hasło pojechało jako skan do
   wyszukiwarki towarów i wylądowało w logu serwera.

   ADRES SERWERA JEST TUTAJ, A NIE TYLKO W USTAWIENIACH — i to nie jest
   duplikat wygody. Ustawienia wiszą pod paskiem górnym, a paska nie ma przed
   zalogowaniem; świeża instalacja startuje z adresem emulatora
   (`10.0.2.2`), który na fizycznym kolektorze nie znaczy nic. Bez tego pola
   pierwsze uruchomienie na sprzęcie kończyło się ekranem, z którego NIE DA SIĘ
   wyjść: zalogować się nie można (kont jeszcze nie ma), kont założyć nie
   można (przycisk pojawia się dopiero po odpowiedzi serwera), a adresu zmienić
   nie można (Ustawienia za bramką sesji).                                    */

/** Co wiemy o serwerze pod aktualnym adresem. */
private enum class StanSerwera { SPRAWDZAM, PUSTY, MA_KONTA, NIEOSIAGALNY }

@Composable
fun SplashScreen(graph: AppGraph) {
    val stan by graph.session.state.collectAsStateWithLifecycle()
    val ustawienia by graph.settings.settings.collectAsStateWithLifecycle()
    var login by remember { mutableStateOf(graph.session.ostatniLogin ?: "") }
    var haslo by remember { mutableStateOf("") }
    var blad by remember { mutableStateOf<String?>(null) }
    var loguje by remember { mutableStateOf(false) }
    /* Trzy odpowiedzi, nie dwie. „Nie widzę serwera" NIE MOŻE wyglądać jak
       „serwer pusty": martwe Wi-Fi zaprosiłoby wtedy do zakładania kont i ktoś
       postawiłby drugi komplet obok istniejącego. */
    var stanSerwera by remember { mutableStateOf(StanSerwera.SPRAWDZAM) }
    var proba by remember { mutableStateOf(0) }
    var adres by remember(ustawienia.serverUrl) { mutableStateOf(ustawienia.serverUrl) }
    var edycjaAdresu by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    // Wedge milczy przez cały czas życia tego ekranu, nie tylko przy fokusie
    // w polu — patrz nagłówek pliku.
    DisposableEffect(Unit) {
        WedgeKeySource.wylaczony = true
        onDispose { WedgeKeySource.wylaczony = false }
    }

    // Sesja może już istnieć (kolektor wrócił z kieszeni, proces był ubity) —
    // wtedy Splash nie ma o co pytać i schodzi z drogi. W efekcie, nie w ciele
    // kompozycji: nawigacja z rysowania to pętla rekompozycji.
    LaunchedEffect(stan) {
        if (stan !is SessionState.Brak) graph.nav.start()
    }

    // Bez tego pytania kolektor prosi o login, którego jeszcze nikt nie
    // założył — bo z samego 401 nie da się odróżnić „system dopiero powstaje"
    // od „pomyliłeś hasło". Powtarzane po każdej zmianie adresu, bo to
    // pierwsze pytanie, na które nowy serwer musi umieć odpowiedzieć.
    LaunchedEffect(proba, ustawienia.serverUrl) {
        stanSerwera = StanSerwera.SPRAWDZAM
        stanSerwera = when (graph.setup.potrzebny()) {
            true -> StanSerwera.PUSTY
            false -> StanSerwera.MA_KONTA
            null -> StanSerwera.NIEOSIAGALNY
        }
    }

    fun sprobuj() {
        if (login.isBlank() || haslo.isBlank() || loguje) return
        scope.launch {
            loguje = true
            val msg = graph.session.zaloguj(login, haslo)
            loguje = false
            if (msg == null) {
                haslo = ""
                graph.feedback.beep(true)
                graph.nav.start()
            } else {
                graph.feedback.beep(false)
                blad = msg
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
            "Zaloguj się",
            fontFamily = BarlowCond,
            fontWeight = FontWeight.Bold,
            fontSize = 22.sp,
            color = Ink,
        )
        Spacer(Modifier.height(8.dp))
        Text(
            "Konto podpisuje każdą operację — pracuj na swoim.",
            fontSize = 13.sp,
            color = InkMute,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(24.dp))

        blad?.let {
            Text(it, fontSize = 14.sp, color = Amber, textAlign = TextAlign.Center)
            Spacer(Modifier.height(12.dp))
        }

        if (stanSerwera == StanSerwera.PUSTY) {
            Text(
                "Na tym serwerze nie ma jeszcze żadnego konta. Zacznij od " +
                    "założenia kont — pierwsze musi być kontem biura.",
                fontSize = 13.sp,
                color = InkMute,
                textAlign = TextAlign.Center,
            )
            Spacer(Modifier.height(8.dp))
            PrimaryButton("ZAŁÓŻ KONTA", modifier = Modifier.fillMaxWidth(), tall = true) {
                graph.nav.openSetup(odZera = true)
            }
            Spacer(Modifier.height(20.dp))
        }

        if (stanSerwera == StanSerwera.NIEOSIAGALNY) {
            Text(
                "Nie widzę serwera pod adresem ${ustawienia.serverUrl}.\n" +
                    "Sprawdź, czy kolektor jest w tej samej sieci i czy adres " +
                    "poniżej jest poprawny.",
                fontSize = 13.sp,
                color = Amber,
                textAlign = TextAlign.Center,
            )
            Spacer(Modifier.height(12.dp))
        }

        WertisTextField(
            value = login,
            onValueChange = { login = it; blad = null },
            placeholder = "login",
            imeAction = ImeAction.Next,
        )
        Spacer(Modifier.height(8.dp))
        WertisTextField(
            value = haslo,
            onValueChange = { haslo = it; blad = null },
            placeholder = "hasło",
            keyboardType = KeyboardType.Password,
            visualTransformation = PasswordVisualTransformation(),
            onDone = { sprobuj() },
        )
        Spacer(Modifier.height(8.dp))
        PrimaryButton(
            if (loguje) "LOGOWANIE…" else "ZALOGUJ",
            modifier = Modifier.fillMaxWidth(),
            enabled = login.isNotBlank() && haslo.isNotBlank() && !loguje,
        ) { sprobuj() }

        Spacer(Modifier.height(24.dp))
        AdresSerwera(
            adres = adres,
            zapisany = ustawienia.serverUrl,
            stanSerwera = stanSerwera,
            rozwiniete = edycjaAdresu || stanSerwera == StanSerwera.NIEOSIAGALNY,
            onZmien = { adres = it },
            onRozwin = { edycjaAdresu = true },
            onZapisz = {
                saveServerUrl(graph, adres)
                // Gdy adres się nie zmienił, `LaunchedEffect(ustawienia.serverUrl)`
                // nie odpali — licznik prób wymusza ponowne pytanie mimo to.
                proba++
            },
        )

        Spacer(Modifier.weight(1f))
        Text("wersja ${BuildConfig.VERSION_NAME}", fontSize = 11.sp, color = InkMute)
    }
}

/**
 * Adres serwera na ekranie startowym.
 *
 * Zwinięty do jednej linijki, dopóki wszystko działa — magazynier nie ma tu
 * czego szukać i nie powinien tego widzieć jako pola do wypełnienia. Rozwija
 * się sam, kiedy serwer jest nieosiągalny, bo wtedy to JEDYNA rzecz do zrobienia
 * na tym ekranie.
 */
@Composable
private fun AdresSerwera(
    adres: String,
    zapisany: String,
    stanSerwera: StanSerwera,
    rozwiniete: Boolean,
    onZmien: (String) -> Unit,
    onRozwin: () -> Unit,
    onZapisz: () -> Unit,
) {
    if (!rozwiniete) {
        Text(
            when (stanSerwera) {
                StanSerwera.SPRAWDZAM -> "Sprawdzam serwer $zapisany…"
                else -> "Serwer: $zapisany"
            },
            fontSize = 11.sp,
            color = InkMute,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(4.dp))
        OutlineButton("ZMIEŃ ADRES SERWERA", modifier = Modifier.fillMaxWidth()) { onRozwin() }
        return
    }

    Text(
        "Adres serwera WERTIS",
        fontSize = 12.sp,
        fontWeight = FontWeight.SemiBold,
        color = Ink,
    )
    Spacer(Modifier.height(4.dp))
    Text(
        "W sieci magazynu: http://<IP-serwera>:3001. Adres 10.0.2.2 działa " +
            "wyłącznie w emulatorze — na kolektorze wskazuje w pustkę.",
        fontSize = 11.sp,
        color = InkMute,
        textAlign = TextAlign.Center,
    )
    Spacer(Modifier.height(8.dp))
    WertisTextField(
        value = adres,
        onValueChange = onZmien,
        placeholder = AppSettings.DEFAULT_SERVER_URL,
        onDone = onZapisz,
    )
    Spacer(Modifier.height(8.dp))
    PrimaryButton(
        "ZAPISZ I SPRAWDŹ",
        modifier = Modifier.fillMaxWidth(),
        enabled = adres.isNotBlank() && stanSerwera != StanSerwera.SPRAWDZAM,
    ) { onZapisz() }
}
