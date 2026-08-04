package pl.wertis.kolektor.ui.setup

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.launch
import pl.wertis.kolektor.AppGraph
import pl.wertis.kolektor.core.session.Rola
import pl.wertis.kolektor.core.setup.Konto
import pl.wertis.kolektor.core.setup.HASLO_MIN
import pl.wertis.kolektor.core.setup.bladKonta
import pl.wertis.kolektor.core.setup.mozliwaWysylka
import pl.wertis.kolektor.core.setup.opisBledu
import pl.wertis.kolektor.data.StanSetupu
import pl.wertis.kolektor.ui.components.OutlineButton
import pl.wertis.kolektor.ui.components.PrimaryButton
import pl.wertis.kolektor.ui.components.SectionCard
import pl.wertis.kolektor.ui.components.SectionLabel
import pl.wertis.kolektor.ui.components.WertisTextField
import pl.wertis.kolektor.ui.theme.Amber
import pl.wertis.kolektor.ui.theme.AmberBg
import pl.wertis.kolektor.ui.theme.AmberInk
import pl.wertis.kolektor.ui.theme.BarlowCond
import pl.wertis.kolektor.ui.theme.CardWhite
import pl.wertis.kolektor.ui.theme.Ink
import pl.wertis.kolektor.ui.theme.InkMute
import pl.wertis.kolektor.ui.theme.InkSoft
import pl.wertis.kolektor.ui.theme.Paper

/* ── Kreator kont (pierwsze uruchomienie) ───────────────────────────────────
   Do tej pory konta zakładało się `curl`-em z DEPLOY §5a. To działa dla kogoś
   z terminalem, ale nie dla osoby, która w poniedziałek rano rozpakowuje
   kolektor — a bez kont aplikacja nie przepuszcza dalej niż ekran startowy.
   Wdrożenie stawało więc na kroku, który z magazynem nie ma nic wspólnego.

   Ekran jest JEDNOSTRONICOWY, nie krokowym czarodziejem: cała lista jest
   widoczna naraz, bo jedyne pytanie brzmi „kto tu pracuje" i odpowiada się na
   nie raz, patrząc na ludzi stojących obok.                                   */

@Composable
fun SetupScreen(graph: AppGraph) {
    val stan by graph.setup.stan.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()

    // `odZera` = pusta instalacja. Ustawiane przez Splash przed wejściem tutaj;
    // decyduje, czy pierwsze konto idzie bez sesji i czy wymagamy admina.
    val odZera = graph.nav.setupOdZera
    val konta = remember { mutableStateListOf(Konto(rola = if (odZera) Rola.ADMIN else Rola.MAGAZYNIER)) }
    var pokazBledy by remember { mutableStateOf(false) }

    when (val s = stan) {
        is StanSetupu.Zakladanie -> {
            PostepZakladania(s.zrobione, s.wszystkich)
            return
        }
        is StanSetupu.Gotowe -> {
            Podsumowanie(s, onDalej = {
                graph.setup.wrocDoWpisywania()
                graph.nav.start()
            })
            return
        }
        StanSetupu.Wpisywanie -> Unit
    }

    val gotowe = mozliwaWysylka(konta.toList(), odZera)

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Paper)
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text(
            if (odZera) "Pierwsze uruchomienie" else "Dodaj osoby",
            fontFamily = BarlowCond,
            fontWeight = FontWeight.ExtraBold,
            fontSize = 28.sp,
            color = Ink,
        )
        Text(
            if (odZera) {
                "Wpisz wszystkich, którzy będą pracować na kolektorze. Pierwsza " +
                    "pozycja musi być kontem biura — to ono zakłada wszystkie następne " +
                    "i tylko ono widzi listę kont."
            } else {
                "Nowe osoby dopisujesz tu samodzielnie — jesteś zalogowany jako biuro."
            },
            fontSize = 13.sp,
            color = InkMute,
        )

        konta.forEachIndexed { i, k ->
            SectionLabel("Osoba ${i + 1}")
            SectionCard {
                WertisTextField(
                    value = k.imieNazwisko,
                    onValueChange = { konta[i] = k.copy(imieNazwisko = it) },
                    placeholder = "Imię i nazwisko",
                )
                Spacer(Modifier.height(8.dp))
                WertisTextField(
                    value = k.login,
                    // login wpisuje biuro, ale kształt narzuca serwer — od razu
                    // odcinamy to, czego i tak nie przyjmie
                    onValueChange = { konta[i] = k.copy(login = it.trim().lowercase()) },
                    placeholder = "Login (np. jkowalski)",
                )
                Spacer(Modifier.height(8.dp))
                WertisTextField(
                    value = k.haslo,
                    onValueChange = { konta[i] = k.copy(haslo = it) },
                    placeholder = "Hasło (min. $HASLO_MIN znaków)",
                    keyboardType = KeyboardType.Password,
                    visualTransformation = PasswordVisualTransformation(),
                )
                Spacer(Modifier.height(8.dp))
                WyborRoli(
                    wybrana = k.rola,
                    // pierwsze konto przy pustej bazie MUSI być biurem — serwer
                    // i tak to wymusi, więc nie udajemy, że jest wybór
                    zablokowane = odZera && i == 0,
                ) { konta[i] = k.copy(rola = it) }

                val blad = if (pokazBledy) bladKonta(k) else null
                blad?.let {
                    Spacer(Modifier.height(6.dp))
                    Text(opisBledu(it), fontSize = 12.sp, fontWeight = FontWeight.Bold, color = Amber)
                }

                if (konta.size > 1) {
                    Row(Modifier.fillMaxWidth().padding(top = 8.dp), horizontalArrangement = Arrangement.End) {
                        Text(
                            "usuń",
                            fontSize = 13.sp,
                            color = InkMute,
                            modifier = Modifier.clickable { konta.removeAt(i) }.padding(6.dp),
                        )
                    }
                }
            }
        }

        OutlineButton("+ DODAJ OSOBĘ", modifier = Modifier.fillMaxWidth()) {
            konta.add(Konto())
        }

        if (pokazBledy && odZera && konta.none { it.rola == Rola.ADMIN }) {
            Text(
                "Potrzebne jest co najmniej jedno konto administratora — bez niego " +
                    "nikt nie założy konta biura ani nie zresetuje hasła.",
                fontSize = 12.sp,
                fontWeight = FontWeight.Bold,
                color = Amber,
            )
        }

        PrimaryButton("ZAŁÓŻ KONTA", modifier = Modifier.fillMaxWidth(), tall = true) {
            pokazBledy = true
            if (gotowe) {
                scope.launch {
                    graph.setup.zaloz(konta.toList(), odZera)
                }
            }
        }
        Spacer(Modifier.height(12.dp))
    }
}

@Composable
private fun WyborRoli(wybrana: Rola, zablokowane: Boolean, onWybor: (Rola) -> Unit) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Rola.entries.forEach { r ->
            val aktywna = r == wybrana
            Text(
                r.etykieta,
                fontSize = 13.sp,
                fontWeight = if (aktywna) FontWeight.Bold else FontWeight.Normal,
                color = if (aktywna) AmberInk else if (zablokowane) InkMute else Ink,
                textAlign = TextAlign.Center,
                modifier = Modifier
                    .weight(1f)
                    .clip(RoundedCornerShape(8.dp))
                    .background(if (aktywna) AmberBg else CardWhite)
                    .then(if (zablokowane) Modifier else Modifier.clickable { onWybor(r) })
                    .padding(vertical = 10.dp),
            )
        }
    }
}

@Composable
private fun PostepZakladania(zrobione: Int, wszystkich: Int) {
    Box(Modifier.fillMaxSize().background(Paper), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(
                "$zrobione / $wszystkich",
                fontFamily = BarlowCond,
                fontWeight = FontWeight.ExtraBold,
                fontSize = 44.sp,
                color = Amber,
            )
            Text("Zakładam konta…", fontSize = 14.sp, color = InkMute)
        }
    }
}

/**
 * Podsumowanie — potwierdzenie, czym się kto zaloguje.
 *
 * Haseł tu nie ma i nie będzie: biuro dopiero co je wpisało, a wypisanie ich
 * na ekranie zamieniłoby ten widok w kartkę do sfotografowania. Loginy są
 * jawne i biuro odczyta je później przez `GET /api/users`.
 */
@Composable
private fun Podsumowanie(s: StanSetupu.Gotowe, onDalej: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Paper)
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text(
            if (s.blad == null) "Konta założone" else "Założone częściowo",
            fontFamily = BarlowCond,
            fontWeight = FontWeight.ExtraBold,
            fontSize = 28.sp,
            color = Ink,
        )
        s.blad?.let {
            Text(
                "$it\n\nKonta z listy poniżej JUŻ ISTNIEJĄ — nie zakładaj ich " +
                    "drugi raz. Brakujące dopisz ponownie.",
                fontSize = 13.sp,
                fontWeight = FontWeight.Bold,
                color = Amber,
            )
        }
        Text(
            "Rozdaj hasła osobiście — nigdzie ich już nie zobaczysz. Loginy " +
                "poniżej biuro odczyta w każdej chwili.",
            fontSize = 13.sp,
            color = InkMute,
        )

        s.konta.forEach { k ->
            SectionCard {
                Text(k.login, fontFamily = BarlowCond, fontWeight = FontWeight.ExtraBold, fontSize = 26.sp, color = Ink)
                Text(k.imieNazwisko, fontSize = 14.sp, fontWeight = FontWeight.Bold, color = Ink)
                Text(k.rola.etykieta, fontSize = 12.sp, color = InkSoft)
            }
        }

        if (s.konta.isEmpty()) {
            Text("Nie powstało żadne konto.", fontSize = 14.sp, color = InkMute)
        }

        PrimaryButton("DALEJ", modifier = Modifier.fillMaxWidth(), tall = true) { onDalej() }
        Spacer(Modifier.height(12.dp))
    }
}
