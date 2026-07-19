package pl.wertis.kolektor.ui.splash

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import pl.wertis.kolektor.AppGraph
import pl.wertis.kolektor.BuildConfig
import pl.wertis.kolektor.ui.components.OutlineButton
import pl.wertis.kolektor.ui.components.PrimaryButton
import pl.wertis.kolektor.ui.components.WertisTextField
import pl.wertis.kolektor.ui.theme.Amber
import pl.wertis.kolektor.ui.theme.BarlowCond
import pl.wertis.kolektor.ui.theme.Ink
import pl.wertis.kolektor.ui.theme.InkMute
import pl.wertis.kolektor.ui.theme.Paper

/* Splash: „Kto pracuje?” — wybór magazyniera (X-User) przed startem. */

@Composable
fun SplashScreen(graph: AppGraph) {
    val users by graph.users.users.collectAsStateWithLifecycle()
    var newName by remember { mutableStateOf("") }
    var adding by remember { mutableStateOf(false) }

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
        Text(
            "Asystent magazyniera",
            fontSize = 14.sp,
            color = InkMute,
        )
        Spacer(Modifier.height(28.dp))
        Text(
            "Kto pracuje?",
            fontFamily = BarlowCond,
            fontWeight = FontWeight.Bold,
            fontSize = 20.sp,
            color = Ink,
        )
        Spacer(Modifier.height(12.dp))

        Column(
            Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            users.list.forEach { name ->
                OutlineButton(
                    text = name,
                    tall = true,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    graph.users.selectUser(name)
                    graph.feedback.beep(true)
                    graph.nav.start()
                }
            }

            if (adding) {
                WertisTextField(
                    value = newName,
                    onValueChange = { newName = it },
                    placeholder = "Imię / ksywka…",
                    onDone = {
                        if (graph.users.addUser(newName) != null) {
                            graph.feedback.beep(true)
                            graph.nav.start()
                        }
                    },
                )
                PrimaryButton("START", modifier = Modifier.fillMaxWidth(), enabled = newName.isNotBlank()) {
                    if (graph.users.addUser(newName) != null) {
                        graph.feedback.beep(true)
                        graph.nav.start()
                    }
                }
            } else {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) {
                    Text(
                        "+ dodaj osobę",
                        color = InkMute,
                        fontSize = 14.sp,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier
                            .clickable { adding = true }
                            .padding(6.dp),
                    )
                }
            }
        }

        Spacer(Modifier.weight(1f))
        Text(
            "wersja ${BuildConfig.VERSION_NAME}",
            fontSize = 11.sp,
            color = InkMute,
        )
    }
}
