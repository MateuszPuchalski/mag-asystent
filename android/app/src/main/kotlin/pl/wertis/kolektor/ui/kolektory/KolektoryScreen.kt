package pl.wertis.kolektor.ui.kolektory

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.launch
import pl.wertis.kolektor.AppGraph
import pl.wertis.kolektor.core.kolektor.doWyboru
import pl.wertis.kolektor.core.kolektor.opisKolektora
import pl.wertis.kolektor.core.net.KolektorView
import pl.wertis.kolektor.core.net.KolektoryResponse
import pl.wertis.kolektor.data.Poll
import pl.wertis.kolektor.data.pollFlow
import pl.wertis.kolektor.net.apiCall
import pl.wertis.kolektor.ui.components.OutlineButton
import pl.wertis.kolektor.ui.components.PrimaryButton
import pl.wertis.kolektor.ui.components.SectionCard
import pl.wertis.kolektor.ui.components.SectionLabel
import pl.wertis.kolektor.ui.theme.BarlowCond
import pl.wertis.kolektor.ui.theme.Ink
import pl.wertis.kolektor.ui.theme.InkMute
import pl.wertis.kolektor.ui.theme.InkSoft

/* ── ZNAJDŹ KOLEKTOR ────────────────────────────────────────────────────────
   Kolega z hali szuka cudzego kolektora ze swojego. Jedna decyzja na
   ekranie: KTÓRY kolektor. Dlatego wiersz niesie to, po czym się go poznaje
   — znak z obudowy i osobę, która na nim ostatnio pracowała — oraz zdanie,
   czy w ogóle zadzwoni. Własnego kolektora na liście nie ma.

   Rytm 5 s, bo po naciśnięciu ZADZWOŃ człowiek patrzy na ekran i czeka na
   „DZWONI". Ekran żyje krótko, więc częstsze pytanie nic tu nie kosztuje. */

@Composable
fun KolektoryScreen(graph: AppGraph) {
    val scope = rememberCoroutineScope()
    val kopniak = remember { MutableSharedFlow<Unit>(extraBufferCapacity = 1) }
    val poll by remember {
        pollFlow(5_000, kick = kopniak) { apiCall { graph.api.kolektory() } }
    }.collectAsState(initial = Poll<KolektoryResponse>())
    var wToku by remember { mutableStateOf(false) }

    fun ruch(k: KolektorView, wezwij: Boolean) {
        if (wToku) return
        wToku = true
        scope.launch {
            try {
                if (wezwij) apiCall { graph.api.wezwijKolektor(k.deviceId) }
                else apiCall { graph.api.zakonczSzukanie(k.deviceId) }
                kopniak.tryEmit(Unit)
            } catch (e: Exception) {
                graph.effects.toast(e.message ?: "Nie udało się")
            } finally {
                wToku = false
            }
        }
    }

    val dane = poll.data
    val lista = dane?.let { doWyboru(it.kolektory, it.ten) }.orEmpty()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text(
            "ZADZWOŃ każe kolektorowi grać głośny alarm przez 5 minut, także ściszonemu. " +
                "Kolektor pyta o to co 10 s. Kończy go ZNALAZŁEM na nim albo PRZESTAŃ tutaj.",
            fontSize = 12.sp,
            color = InkSoft,
        )
        poll.error?.let { Text(it, fontSize = 12.sp, color = InkMute) }
        if (dane != null && lista.isEmpty()) {
            Text("Żaden inny kolektor nie logował się w ostatnich 30 dniach.", fontSize = 14.sp, color = InkSoft)
        }
        SectionLabel("Kolektory")
        for (k in lista) {
            SectionCard {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Column(Modifier.weight(1f)) {
                        Text(
                            k.etykieta,
                            fontFamily = BarlowCond,
                            fontWeight = FontWeight.ExtraBold,
                            fontSize = 22.sp,
                            color = Ink,
                        )
                        Text(k.ostatniaOsoba ?: "—", fontSize = 14.sp, fontWeight = FontWeight.Bold, color = Ink)
                        Text(opisKolektora(k), fontSize = 12.sp, color = InkSoft)
                    }
                    if (k.wezwanie != null) {
                        OutlineButton("PRZESTAŃ", enabled = !wToku) { ruch(k, wezwij = false) }
                    } else {
                        PrimaryButton("ZADZWOŃ", enabled = !wToku && k.zalogowany) { ruch(k, wezwij = true) }
                    }
                }
            }
        }
    }
}
