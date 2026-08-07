package pl.wertis.kolektor.ui.splash

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import pl.wertis.kolektor.core.net.ZnalezionySerwer
import pl.wertis.kolektor.core.net.opisAdresu
import pl.wertis.kolektor.core.net.parsujKodParowania
import pl.wertis.kolektor.net.szukajSerwerow
import pl.wertis.kolektor.scan.ScanHandlerEffect
import pl.wertis.kolektor.scan.WedgeKeySource
import pl.wertis.kolektor.ui.components.OutlineButton
import pl.wertis.kolektor.ui.components.PrimaryButton
import pl.wertis.kolektor.ui.theme.Amber
import pl.wertis.kolektor.ui.theme.AmberBgSoft
import pl.wertis.kolektor.ui.theme.AmberLine
import pl.wertis.kolektor.ui.theme.BarlowCond
import pl.wertis.kolektor.ui.theme.CardWhite
import pl.wertis.kolektor.ui.theme.Ink
import pl.wertis.kolektor.ui.theme.InkMute

/* ── Parowanie kolektora z serwerem ─────────────────────────────────────────
   Trzy drogi do tego samego adresu, w kolejności od najmniej pracy:

   1. KONFIGURACJA Z MDM — dzieje się bez tego ekranu (`KonfiguracjaZarzadzana`).
      Kolektor po wyczyszczeniu wstaje skonfigurowany i nikt tu nie trafia.
   2. SKAN KODU ze strony `/parowanie`, wydrukowanej i powieszonej przy
      ładowarce. Skaner ma każdy magazynier, a kod działa nawet wtedy, gdy
      punkt dostępowy odrzuca rozgłoszenia.
   3. ROZGŁOSZENIE UDP — „SZUKAJ SERWERA". Zero czynności poza naciśnięciem,
      ale zależy od tego, co przepuszcza sieć.

   Wpisanie adresu z klawiatury zostaje jako czwarta droga, w panelu obok.

   ŻADNA ZE ZNALEZIONYCH DRÓG NIE WIĄŻE KOLEKTORA SAMA. Adres z rozgłoszenia
   i adres z kodu trafiają najpierw na potwierdzenie, z adresem wypisanym tak,
   żeby dało się go porównać z napisem pod kodem QR. Powód jest w DEPLOY.md §4:
   bez TLS-a nic nie odróżnia serwera od cudzego urządzenia w tej samej sieci,
   więc ostatnim sprawdzeniem jest wzrok człowieka. Kolektor związany po cichu
   z podstawionym adresem oddaje mu login i hasło pierwszej osoby, która
   przyjdzie na zmianę.                                                       */

@Composable
fun PanelParowania(
    aktualnyAdres: String,
    onWybrano: (String) -> Unit,
    onWpiszRecznie: () -> Unit,
) {
    var szukam by remember { mutableStateOf(false) }
    var szukanoJuz by remember { mutableStateOf(false) }
    var znalezione by remember { mutableStateOf<List<ZnalezionySerwer>>(emptyList()) }
    var doPotwierdzenia by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    /* Szczelina w wyłączonym skanerze — dokładnie na czas tego panelu i
       dokładnie na kształt kodu parowania. Wszystko inne, co wpadnie do
       bufora wedge'a, ginie w `WedgeKeySource` (patrz komentarz przy fladze). */
    DisposableEffect(Unit) {
        WedgeKeySource.tylkoParowanie = true
        onDispose { WedgeKeySource.tylkoParowanie = false }
    }

    // Skanery sprzętowe (Zebra/Honeywell) omijają wedge i trafiają wprost na
    // szynę — dlatego kod parowania przechwytujemy też tutaj.
    ScanHandlerEffect { scan ->
        val adres = parsujKodParowania(scan.code)
        if (adres != null) {
            doPotwierdzenia = adres
            true
        } else {
            false
        }
    }

    // Kopia do lokalnej wartości — `doPotwierdzenia` jest właściwością
    // delegowaną (`by remember`), więc sam warunek nie zawęziłby typu.
    val potwierdzany = doPotwierdzenia
    if (potwierdzany != null) {
        Potwierdzenie(
            adres = potwierdzany,
            onPotwierdz = {
                doPotwierdzenia = null
                onWybrano(potwierdzany)
            },
            onAnuluj = { doPotwierdzenia = null },
        )
        return
    }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(CardWhite, RoundedCornerShape(12.dp))
            .border(1.dp, AmberLine, RoundedCornerShape(12.dp))
            .padding(14.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            "Połącz z serwerem",
            fontFamily = BarlowCond,
            fontWeight = FontWeight.Bold,
            fontSize = 18.sp,
            color = Ink,
        )
        Spacer(Modifier.height(4.dp))
        Text(
            "Zeskanuj kod ze strony parowania — wydruk wisi przy ładowarce. " +
                "Albo poszukaj serwera w sieci.",
            fontSize = 12.sp,
            color = InkMute,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(12.dp))

        PrimaryButton(
            if (szukam) "SZUKAM…" else "SZUKAJ SERWERA",
            modifier = Modifier.fillMaxWidth(),
            enabled = !szukam,
            tall = true,
        ) {
            scope.launch {
                szukam = true
                znalezione = szukajSerwerow()
                szukam = false
                szukanoJuz = true
            }
        }

        if (znalezione.isNotEmpty()) {
            Spacer(Modifier.height(12.dp))
            Text(
                if (znalezione.size == 1) "Znaleziony serwer:" else "Znalezione serwery:",
                fontSize = 12.sp,
                fontWeight = FontWeight.SemiBold,
                color = Ink,
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(6.dp))
            znalezione.forEach { serwer ->
                OutlineButton(
                    opisAdresu(serwer.url) + (serwer.wersja?.let { "  ·  $it" } ?: ""),
                    modifier = Modifier.fillMaxWidth(),
                ) { doPotwierdzenia = serwer.url }
                Spacer(Modifier.height(6.dp))
            }
        }

        if (szukanoJuz && znalezione.isEmpty() && !szukam) {
            Spacer(Modifier.height(10.dp))
            Text(
                "Nie znalazłem serwera w tej sieci. To nie znaczy, że go nie ma — " +
                    "część punktów dostępowych nie przepuszcza rozgłoszeń. " +
                    "Zeskanuj kod parowania albo wpisz adres ręcznie.",
                fontSize = 12.sp,
                color = Amber,
                textAlign = TextAlign.Center,
            )
        }

        Spacer(Modifier.height(10.dp))
        Text(
            "Teraz: ${opisAdresu(aktualnyAdres)}",
            fontSize = 11.sp,
            color = InkMute,
        )
        Spacer(Modifier.height(6.dp))
        OutlineButton("WPISZ ADRES RĘCZNIE", modifier = Modifier.fillMaxWidth()) { onWpiszRecznie() }
    }
}

/**
 * Potwierdzenie adresu przed związaniem się z nim.
 *
 * Adres jest tu NAJWIĘKSZYM napisem na ekranie, bo to jedyna rzecz, którą
 * człowiek ma naprawdę porównać — z napisem pod kodem QR na wydruku. Ekran
 * pytający „połączyć?" drobnym drukiem obok wielkiego przycisku TAK
 * nie byłby sprawdzeniem, tylko jego pozorem.
 */
@Composable
private fun Potwierdzenie(adres: String, onPotwierdz: () -> Unit, onAnuluj: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(AmberBgSoft, RoundedCornerShape(12.dp))
            .border(1.dp, AmberLine, RoundedCornerShape(12.dp))
            .padding(14.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("Połączyć z tym serwerem?", fontSize = 13.sp, color = InkMute)
        Spacer(Modifier.height(8.dp))
        Text(
            opisAdresu(adres),
            fontFamily = BarlowCond,
            fontWeight = FontWeight.ExtraBold,
            fontSize = 24.sp,
            color = Ink,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(8.dp))
        Text(
            "Sprawdź, czy ten adres zgadza się z napisem pod kodem QR.",
            fontSize = 12.sp,
            color = InkMute,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(12.dp))
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlineButton("ANULUJ", modifier = Modifier.weight(1f), tall = true) { onAnuluj() }
            PrimaryButton("POŁĄCZ", modifier = Modifier.weight(1f), tall = true) { onPotwierdz() }
        }
    }
}
