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
import androidx.compose.runtime.getValue
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
import pl.wertis.kolektor.data.AppSettings
import pl.wertis.kolektor.data.userInitials
import pl.wertis.kolektor.ui.components.OutlineButton
import pl.wertis.kolektor.ui.components.PrimaryButton
import pl.wertis.kolektor.ui.components.SectionCard
import pl.wertis.kolektor.ui.components.SectionLabel
import pl.wertis.kolektor.ui.components.WertisTextField
import pl.wertis.kolektor.ui.theme.Amber
import pl.wertis.kolektor.ui.theme.Ink
import pl.wertis.kolektor.ui.theme.InkMute
import pl.wertis.kolektor.ui.theme.InkSoft

/* ── Ustawienia — port web/src/screens/Settings.tsx, bez sekcji głosowych ───
   Użytkownicy (hot-swap), adres serwera (nowość w wersji natywnej) oraz
   przełączniki funkcji urządzenia. Skaner sprzętowy nie wymaga konfiguracji. */

@Composable
fun SettingsScreen(graph: AppGraph) {
    val users by graph.users.users.collectAsStateWithLifecycle()
    val settings by graph.settings.settings.collectAsStateWithLifecycle()
    var newUser by remember { mutableStateOf("") }
    var serverUrl by remember { mutableStateOf(settings.serverUrl) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        SectionLabel("Użytkownicy kolektora")
        SectionCard {
            users.list.forEach { name ->
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { graph.users.selectUser(name) }
                        .padding(vertical = 7.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Box(
                        modifier = Modifier.size(30.dp).clip(CircleShape)
                            .background(if (name == users.current) Amber else InkMute.copy(alpha = 0.25f)),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(userInitials(name), fontSize = 12.sp, fontWeight = FontWeight.Bold, color = Ink)
                    }
                    Text(
                        name,
                        fontSize = 14.sp,
                        fontWeight = if (name == users.current) FontWeight.Bold else FontWeight.Normal,
                        color = Ink,
                        modifier = Modifier.weight(1f),
                    )
                    if (name == users.current) {
                        Text("aktywny", fontSize = 11.sp, color = InkSoft)
                    } else if (users.list.size > 1) {
                        Text(
                            "usuń",
                            fontSize = 12.sp,
                            color = InkMute,
                            modifier = Modifier
                                .clickable { graph.users.removeUser(name) }
                                .padding(4.dp),
                        )
                    }
                }
            }
            Row(
                modifier = Modifier.fillMaxWidth().padding(top = 6.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                WertisTextField(
                    value = newUser,
                    onValueChange = { newUser = it },
                    placeholder = "Nowa osoba…",
                    modifier = Modifier.weight(1f),
                    onDone = {
                        if (graph.users.addUser(newUser) != null) newUser = ""
                    },
                )
                PrimaryButton("DODAJ", enabled = newUser.isNotBlank()) {
                    if (graph.users.addUser(newUser) != null) newUser = ""
                }
            }
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
                    onDone = { graph.settings.update { s -> s.copy(serverUrl = serverUrl.trim()) } },
                )
                OutlineButton("ZAPISZ") {
                    graph.settings.update { s -> s.copy(serverUrl = serverUrl.trim()) }
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
                "Potrząśnij = COFNIJ",
                "działa tylko w oknie karencji po zapisie",
                settings.shakeUndo,
            ) { v -> graph.settings.update { it.copy(shakeUndo = v) } }
            ToggleRow(
                "Log upadków urządzenia",
                "wpis audytowy device_drop dla serwisu",
                settings.dropLog,
            ) { v -> graph.settings.update { it.copy(dropLog = v) } }
            ToggleRow(
                "Tryb marszu",
                "wielka karta następnego celu po zatwierdzeniu wózka",
                settings.walkMode,
            ) { v -> graph.settings.update { it.copy(walkMode = v) } }
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

        OutlineButton("ZMIEŃ UŻYTKOWNIKA (EKRAN STARTOWY)", modifier = Modifier.fillMaxWidth()) {
            graph.nav.go(Screen.SPLASH)
        }
    }
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
