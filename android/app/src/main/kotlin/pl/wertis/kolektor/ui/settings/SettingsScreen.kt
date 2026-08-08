package pl.wertis.kolektor.ui.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import pl.wertis.kolektor.AppGraph
import pl.wertis.kolektor.BuildConfig
import pl.wertis.kolektor.core.nav.Screen
import pl.wertis.kolektor.core.net.MagazynInfo
import pl.wertis.kolektor.core.net.WidocznoscRequest
import pl.wertis.kolektor.net.apiCall
import kotlinx.coroutines.launch
import pl.wertis.kolektor.data.AppSettings
import pl.wertis.kolektor.core.session.SessionState
import pl.wertis.kolektor.core.session.biurowa
import pl.wertis.kolektor.core.session.osoba
import pl.wertis.kolektor.core.session.userInitials
import pl.wertis.kolektor.ui.components.OutlineButton
import pl.wertis.kolektor.ui.components.PrimaryButton
import pl.wertis.kolektor.ui.components.SectionCard
import pl.wertis.kolektor.ui.components.SectionLabel
import pl.wertis.kolektor.ui.components.WertisTextField
import pl.wertis.kolektor.ui.theme.Amber
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.text.style.TextAlign
import pl.wertis.kolektor.ui.theme.AmberBg
import pl.wertis.kolektor.ui.theme.AmberInk
import pl.wertis.kolektor.ui.theme.CardWhite
import pl.wertis.kolektor.ui.theme.Ink
import pl.wertis.kolektor.ui.theme.InkMute
import pl.wertis.kolektor.ui.theme.InkSoft

/* ── Ustawienia — port web/src/screens/Settings.tsx, bez sekcji głosowych ───
   Użytkownicy (hot-swap), adres serwera (nowość w wersji natywnej) oraz
   przełączniki funkcji urządzenia. Skaner sprzętowy nie wymaga konfiguracji. */

@Composable
fun SettingsScreen(graph: AppGraph) {
    val stan by graph.session.state.collectAsStateWithLifecycle()
    val settings by graph.settings.settings.collectAsStateWithLifecycle()
    var serverUrl by remember { mutableStateOf(settings.serverUrl) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        SectionLabel("Kto pracuje")
        SectionCard {
            // Lista imion wpisywanych z klawiatury zniknęła razem z nagłówkiem
            // X-User (plan §7): tożsamość rozstrzyga login i hasło po stronie
            // serwera. Konta zakłada biuro, nie kolektor.
            Row(
                modifier = Modifier.fillMaxWidth().padding(vertical = 7.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Box(
                    modifier = Modifier.size(30.dp).clip(CircleShape)
                        .background(if (stan is SessionState.Brak) InkMute.copy(alpha = 0.25f) else Amber),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        userInitials(stan.osoba ?: "?"),
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Bold,
                        color = Ink,
                    )
                }
                Column(Modifier.weight(1f)) {
                    Text(
                        stan.osoba ?: "nikt nie jest zalogowany",
                        fontSize = 14.sp,
                        fontWeight = FontWeight.Bold,
                        color = Ink,
                    )
                    Text(
                        // `when (val s = ...)`, bo `stan` jest właściwością
                        // delegowaną — smart cast by się nie odbył
                        when (val s = stan) {
                            is SessionState.Aktywna -> s.role
                            SessionState.Brak -> "zaloguj się, żeby zacząć"
                        },
                        fontSize = 11.sp,
                        color = InkSoft,
                    )
                }
            }
            if (stan.biurowa) {
                // Dopisywanie osób bez terminala — ta sama droga co przy
                // pierwszym uruchomieniu, tylko z istniejącą sesją biura.
                OutlineButton("DODAJ OSOBY", modifier = Modifier.fillMaxWidth().padding(top = 6.dp)) {
                    graph.nav.openSetup(odZera = false)
                }
            }
            if (stan !is SessionState.Brak) {
                // Wylogowanie to JAWNA decyzja człowieka. Bezczynność blokuje,
                // nie wylogowuje — sesja gubiąca 30 rozłożonych pozycji to
                // najprostszy sposób na aplikację leżącą w szufladzie.
                Row(
                    modifier = Modifier.fillMaxWidth().padding(top = 6.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    PrimaryButton("WYLOGUJ") { graph.session.wyloguj() }
                }
            }
        }

        /* Widoczność magazynów — tylko dla biura, bo ustawienie jest GLOBALNE:
           przestawia karty towaru na wszystkich kolektorach naraz. Ta sama
           bramka co przy kontach (rola + PIN), dlatego siedzi obok. */
        if (stan.biurowa) {
            SectionLabel("Magazyny")
            MagazynySekcja(graph)
        }

        SectionLabel("Serwer WERTIS")
        SectionCard {
            Text(
                "Adres serwera aplikacji (API). Emulator: http://10.0.2.2:3001, kolektor: adres w sieci magazynu.",
                fontSize = 11.sp,
                color = InkMute,
            )
            Row(
                modifier = Modifier.fillMaxWidth().padding(top = 6.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                WertisTextField(
                    value = serverUrl,
                    onValueChange = { serverUrl = it },
                    placeholder = AppSettings.DEFAULT_SERVER_URL,
                    modifier = Modifier.weight(1f),
                    onDone = { saveServerUrl(graph, serverUrl) },
                )
                OutlineButton("ZAPISZ") {
                    saveServerUrl(graph, serverUrl)
                    graph.effects.toast("Zapisano adres serwera")
                }
            }
        }

        SectionLabel("Funkcje urządzenia")
        SectionCard {
            ToggleRow(
                "Ekran zawsze włączony",
                "wake lock podczas pracy",
                settings.wakeLock,
            ) { v -> graph.settings.update { it.copy(wakeLock = v) } }
            ToggleRow(
                "Log upadków urządzenia",
                "wpis audytowy device_drop dla serwisu",
                settings.dropLog,
            ) { v -> graph.settings.update { it.copy(dropLog = v) } }
            ToggleRow(
                "Asysta niskiej baterii",
                "flush bufora + ostrzeżenie przy <15% (hot-swap)",
                settings.batteryAssist,
            ) { v -> graph.settings.update { it.copy(batteryAssist = v) } }
        }

        Text(
            "WERTIS Kolektor ${BuildConfig.VERSION_NAME} · natywna aplikacja Android",
            fontSize = 11.sp,
            color = InkMute,
            modifier = Modifier.fillMaxWidth().padding(top = 6.dp),
        )

        OutlineButton("EKRAN LOGOWANIA", modifier = Modifier.fillMaxWidth()) {
            graph.nav.go(Screen.SPLASH)
        }
    }
}

/**
 * Zmiana adresu unieważnia zapamiętaną regułę lokalizacji — inny serwer to inny
 * magazyn i potencjalnie inny wzorzec adresu. Do czasu pobrania nowej reguły
 * skaner wraca do trybu ostrożnego, zamiast stosować wzorzec cudzego magazynu.
 *
 * Widoczne poza Ustawieniami, bo ekran startowy musi umieć to samo: przed
 * zalogowaniem Ustawienia są niedostępne (nie ma paska górnego), a to właśnie
 * wtedy adres bywa zły — świeża instalacja startuje z adresem emulatora.
 */
fun saveServerUrl(graph: AppGraph, url: String) {
    val next = url.trim()
    if (next != graph.settings.current.serverUrl) {
        graph.locationsRepo.forget()
        // to samo dotyczy każdej zapamiętanej odpowiedzi — inny serwer to inne
        // towary, inne magazyny i inna odpowiedź na „czy są konta"
        graph.magazynyRepo.forget()
        graph.cards.clear()
        graph.setup.zapomnijWerdykt()
    }
    graph.settings.update { s -> s.copy(serverUrl = next) }
    /* Podmiana NATYCHMIAST, nie przez obserwatora w `AppGraph.init`. Oba
       czytają ten sam `StateFlow`, ale kolejność dwóch niezależnych kolektorów
       nie jest niczym zagwarantowana — a ekran startowy odpytuje serwer zaraz
       po zapisie. Przy niepomyślnej kolejności sprawdzenie poszłoby pod STARY
       adres i poprawny nowy adres zostałby pokazany jako nieosiągalny. Setter
       jest idempotentny, więc późniejsze przejście obserwatora nic nie zmienia. */
    graph.apiClient.setBaseUrl(next)
}

@Composable
private fun ToggleRow(title: String, sub: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 5.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Column(Modifier.weight(1f)) {
            Text(title, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = Ink)
            Text(sub, fontSize = 11.sp, color = InkMute)
        }
        Switch(
            checked = checked,
            onCheckedChange = onChange,
            colors = SwitchDefaults.colors(
                checkedTrackColor = Amber,
                checkedThumbColor = Ink,
            ),
        )
    }
}

/* ── Widoczność magazynów ───────────────────────────────────────────────────
   Ustawienie GLOBALNE, trzymane przez serwer. Ukrycie na jednym kolektorze
   znaczyłoby, że dwie osoby patrzą na ten sam towar i widzą co innego — a to
   różnica, której na hali nikt nie skojarzy z ustawieniami.

   MAG, MGP i Zwroty są wyszarzone i podpisane rolą. Zablokowany przełącznik
   bez powodu wygląda jak usterka, więc powód stoi obok: te trzy prowadzą
   rozkładanie i karta bez nich nie powiedziałaby, ile zostało do zrobienia. */

@Composable
private fun MagazynySekcja(graph: AppGraph) {
    // posiew z cache — sekcja rysuje się od razu, świeża lista dochodzi w tle
    var magazyny by remember { mutableStateOf(graph.magazynyRepo.cached() ?: emptyList()) }
    var ukryte by remember { mutableStateOf(magazyny.filter { it.ukryty }.map { it.magId }.toSet()) }
    var zapisuje by remember { mutableStateOf(false) }
    var blad by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(Unit) {
        try {
            val r = graph.magazynyRepo.refresh()
            magazyny = r
            ukryte = r.filter { it.ukryty }.map { it.magId }.toSet()
        } catch (e: Exception) {
            // ze starą listą da się pracować; bez żadnej — trzeba powiedzieć czemu
            if (magazyny.isEmpty()) blad = e.message ?: "Nie udało się pobrać listy magazynów"
        }
    }

    SectionCard {
        Text(
            "Magazyny odznaczone nie pojawiają się na karcie towaru. Ustawienie dotyczy " +
                "WSZYSTKICH kolektorów.",
            fontSize = 11.sp,
            color = InkMute,
        )

        if (magazyny.isEmpty() && blad == null) {
            Text("Wczytywanie…", fontSize = 12.sp, color = InkMute, modifier = Modifier.padding(top = 8.dp))
        }

        magazyny.forEach { m ->
            val zRola = m.rola != null
            Row(
                modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        m.kod,
                        fontSize = 13.sp,
                        fontWeight = FontWeight.Bold,
                        color = if (zRola) InkMute else Ink,
                    )
                    Text(
                        if (zRola) "${m.nazwa} · prowadzi rozkładanie, zawsze widoczny"
                        else m.nazwa,
                        fontSize = 11.sp,
                        color = InkMute,
                    )
                }
                Switch(
                    checked = zRola || m.magId !in ukryte,
                    enabled = !zRola,
                    onCheckedChange = { widoczny ->
                        ukryte = if (widoczny) ukryte - m.magId else ukryte + m.magId
                    },
                    colors = SwitchDefaults.colors(
                        checkedTrackColor = Amber,
                        checkedThumbColor = Ink,
                    ),
                )
            }
        }

        if (magazyny.any { it.rola == null }) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(top = 10.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                OutlineButton(if (zapisuje) "ZAPISUJĘ…" else "ZAPISZ") {
                    if (zapisuje) return@OutlineButton
                    zapisuje = true
                    blad = null
                    scope.launch {
                        try {
                            // lista PEŁNA, nie różnica — dwie osoby w ustawieniach
                            // naraz nie mogą po cichu zgubić jednej z decyzji
                            val r = apiCall {
                                graph.api.setWidocznoscMagazynow(
                                    WidocznoscRequest(ukryte = ukryte.toList())
                                )
                            }
                            magazyny = r.magazyny
                            ukryte = r.magazyny.filter { it.ukryty }.map { it.magId }.toSet()
                            // odpowiedź zapisu niesie świeżą listę — do cache,
                            // żeby arkusz przesunięcia nie rysował sprzed zmiany
                            graph.magazynyRepo.przyjmij(r.magazyny)
                            graph.effects.toast("Zapisano widoczność magazynów")
                        } catch (e: Exception) {
                            blad = e.message ?: "Nie udało się zapisać"
                        } finally {
                            zapisuje = false
                        }
                    }
                }
            }
        }

        blad?.let {
            Text(it, fontSize = 11.sp, color = AmberInk, modifier = Modifier.padding(top = 6.dp))
        }
    }
}
