package pl.wertis.kolektor.ui.settings

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
import androidx.compose.runtime.LaunchedEffect
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
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlinx.coroutines.launch
import pl.wertis.kolektor.AppGraph
import pl.wertis.kolektor.core.net.PrzerwaCiszy
import pl.wertis.kolektor.core.net.hostSerwera
import pl.wertis.kolektor.core.net.powodOdmowy
import pl.wertis.kolektor.core.net.tasamaPodsiec
import pl.wertis.kolektor.device.OpisDrogi
import pl.wertis.kolektor.net.apiCall
import pl.wertis.kolektor.ui.components.OutlineButton
import pl.wertis.kolektor.ui.components.PrimaryButton
import pl.wertis.kolektor.ui.components.SectionCard
import pl.wertis.kolektor.ui.components.SectionLabel
import pl.wertis.kolektor.ui.theme.Ink
import pl.wertis.kolektor.ui.theme.InkMute
import pl.wertis.kolektor.ui.theme.InkSoft

/* ── Diagnostyka łączności (0.323.0) ─────────────────────────────────────────
   Zgłoszenie właściciela: „czasem kolektor traci połączenie z aplikacją, choć
   jest w tej samej sieci co serwer — może chodzi o przeskok między punktami
   dostępowymi?". Na pytanie NIE DA SIĘ dziś odpowiedzieć, i to jest usterka.

   Cztery przyczyny wyglądają na ekranie identycznie: dziura w zasięgu, druga
   podsieć, izolacja klientów na punkcie dostępowym i zapora. `DEPLOY.md` opisuje
   rozpoznanie każdej z nich — ręcznie, z ustawień Androida, czyli wtedy, gdy
   magazynier stoi przy regale w rękawicy.

   TEN EKRAN NICZEGO NIE NAPRAWIA I NIC W SIECI NIE PRZESTAWIA. To była decyzja
   właściciela: najpierw wiedzieć, potem leczyć. Zmiana drogi sieciowej wysłana
   na podstawie domysłu może przecież naprawiać coś, czego nie ma.

   DZIENNIK JEST WAŻNIEJSZY OD PRZYCISKU. Przycisk „sprawdź teraz" odpowiada
   o tym, co jest w tej chwili — a w tej chwili zwykle działa, bo człowiek
   otwiera Ustawienia po fakcie. Dziennik odpowiada na pytanie, którego nikt
   nie umiał zapamiętać: czy przerwa skończyła się sama, po ilu sekundach
   i z jakim powodem.                                                          */

private val GODZINA = SimpleDateFormat("HH:mm:ss", Locale("pl"))

@Composable
fun PolaczenieScreen(graph: AppGraph) {
    val settings by graph.settings.settings.collectAsStateWithLifecycle()
    var droga by remember { mutableStateOf(graph.connectivity.opisDrogi()) }
    var wynik by remember { mutableStateOf<String?>(null) }
    var trwa by remember { mutableStateOf(false) }
    /* Lista przerw jest kopią pobieraną przy odświeżeniu, nie strumieniem.
       Dziennik zmienia się co 1,5 s i lista skacząca pod palcem czytającego
       byłaby gorsza niż lista o dwie sekundy starsza. */
    var przerwy by remember { mutableStateOf(graph.queueRepo.dziennikCiszy.przerwy()) }
    val scope = rememberCoroutineScope()

    fun sprawdz() {
        if (trwa) return
        trwa = true
        wynik = null
        scope.launch {
            val start = System.currentTimeMillis()
            wynik = try {
                val h = apiCall { graph.api.health() }
                "odpowiedział po ${System.currentTimeMillis() - start} ms — WERTIS ${h.wersja}"
            } catch (e: Exception) {
                "BEZ ODPOWIEDZI po ${System.currentTimeMillis() - start} ms: ${powodOdmowy(e)}"
            }
            droga = graph.connectivity.opisDrogi()
            przerwy = graph.queueRepo.dziennikCiszy.przerwy()
            trwa = false
        }
    }

    /* Sprawdzenie przy wejściu, bez pytania. Człowiek otwiera ten ekran wtedy,
       gdy coś nie działa — kazać mu wtedy szukać przycisku to kazać mu wykonać
       czynność, której wynik i tak jest jedyną treścią ekranu. */
    LaunchedEffect(Unit) { sprawdz() }

    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        SectionLabel("Serwer")
        SectionCard {
            Wiersz("Adres", settings.serverUrl)
            Wiersz("Odpowiedź", wynik ?: if (trwa) "pytam…" else "—")
            PrimaryButton(
                if (trwa) "SPRAWDZAM…" else "SPRAWDŹ TERAZ",
                modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                enabled = !trwa,
            ) { sprawdz() }
        }

        SectionLabel("Droga do serwera")
        SectionCard {
            Wiersz("Sieć", droga.rodzaj ?: "brak sieci")
            Wiersz("Adres kolektora", droga.adres ?: "nieznany")
            Wiersz("Interfejs", droga.interfejs ?: "nieznany")
            if (droga.dns.isNotEmpty()) Wiersz("DNS", droga.dns.joinToString(", "))
            Werdykt(droga, settings.serverUrl)
        }

        SectionLabel("Przerwy w łączności")
        SectionCard {
            if (przerwy.isEmpty()) {
                Text(
                    "Od uruchomienia aplikacji nie było ani jednej przerwy.",
                    fontSize = 12.sp, color = InkSoft,
                )
            } else {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    przerwy.forEach { PrzerwaWiersz(it) }
                }
            }
            Text(
                "Zapis żyje do zamknięcia aplikacji i nie jest nigdzie wysyłany.",
                fontSize = 11.sp, color = InkMute, modifier = Modifier.padding(top = 8.dp),
            )
        }

        OutlineButton("ODŚWIEŻ LISTĘ", modifier = Modifier.fillMaxWidth()) {
            przerwy = graph.queueRepo.dziennikCiszy.przerwy()
            droga = graph.connectivity.opisDrogi()
        }
    }
}

/**
 * Zdanie, które mówi, CZEGO szukać — albo milczy.
 *
 * Milczenie jest tu pełnoprawną odpowiedzią. Serwer podany nazwą
 * (`mag.wertis.local`, tak jak zaleca `DEPLOY.md`) nie daje się porównać
 * z adresem kolektora, a zgadnięty werdykt wysłałby człowieka do przestawiania
 * sieci, która jest dobra.
 */
@Composable
private fun Werdykt(droga: OpisDrogi, serverUrl: String) {
    val host = hostSerwera(serverUrl)
    val zdanie = when (tasamaPodsiec(droga.adres, host)) {
        true -> "Kolektor i serwer stoją w tej samej podsieci. Gdy mimo to nie ma " +
            "odpowiedzi, zostaje izolacja klientów na punkcie dostępowym albo zapora " +
            "serwera — rozpoznanie w DEPLOY.md."
        false -> "INNA PODSIEĆ niż serwer. To najczęstsza przyczyna ciszy: zapora " +
            "serwera wpuszcza wyłącznie własną podsieć. Punkty dostępowe mają być " +
            "spięte w jedną sieć — patrz DEPLOY.md."
        null -> null
    }
    if (zdanie != null) {
        Text(zdanie, fontSize = 12.sp, color = Ink, modifier = Modifier.padding(top = 8.dp))
    }
}

@Composable
private fun PrzerwaWiersz(p: PrzerwaCiszy) {
    val koniec = p.doKiedy
    val opis = if (koniec == null) {
        "trwa od ${GODZINA.format(Date(p.odKiedy))}"
    } else {
        val sekundy = ((koniec - p.odKiedy) / 1000.0)
        "${GODZINA.format(Date(p.odKiedy))} — ${GODZINA.format(Date(koniec))} " +
            "(${String.format(Locale("pl"), "%.1f", sekundy)} s)"
    }
    Column {
        Text(
            opis,
            fontSize = 13.sp,
            fontWeight = FontWeight.Bold,
            /* Trwająca przerwa nie jest tym samym pytaniem co zakończona,
               więc nie ma wyglądać tak samo. */
            color = if (koniec == null) Ink else InkSoft,
        )
        Text("${p.prob} nieudanych prób · ${p.powod}", fontSize = 11.sp, color = InkMute)
    }
}

@Composable
private fun Wiersz(nazwa: String, wartosc: String) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 3.dp),
        verticalAlignment = Alignment.Top,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(nazwa, fontSize = 12.sp, color = InkSoft, modifier = Modifier.fillMaxWidth(0.36f))
        Text(wartosc, fontSize = 12.sp, color = Ink, modifier = Modifier.weight(1f))
    }
}
