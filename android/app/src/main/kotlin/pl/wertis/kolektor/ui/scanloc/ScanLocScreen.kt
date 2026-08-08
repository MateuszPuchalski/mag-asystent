package pl.wertis.kolektor.ui.scanloc

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import pl.wertis.kolektor.AppGraph
import pl.wertis.kolektor.core.loc.normalizeLoc
import pl.wertis.kolektor.core.loc.validateLoc
import pl.wertis.kolektor.core.nav.Screen
import pl.wertis.kolektor.core.net.LocAction
import pl.wertis.kolektor.core.net.LocationsInfo
import pl.wertis.kolektor.core.scan.ScanKind
import pl.wertis.kolektor.data.Poll
import pl.wertis.kolektor.data.pollFlow
import pl.wertis.kolektor.net.apiCall
import pl.wertis.kolektor.scan.ScanHandlerEffect
import pl.wertis.kolektor.ui.components.LoadingRow
import pl.wertis.kolektor.ui.components.PrimaryButton
import pl.wertis.kolektor.ui.components.WertisTextField
import pl.wertis.kolektor.ui.product.LocChoice
import pl.wertis.kolektor.ui.product.MiniaturaTowaru
import pl.wertis.kolektor.ui.product.saveLocation
import pl.wertis.kolektor.ui.product.LocChoiceSheet
import pl.wertis.kolektor.ui.theme.Amber
import pl.wertis.kolektor.ui.theme.AmberBgSoft
import pl.wertis.kolektor.ui.theme.AmberDark
import pl.wertis.kolektor.ui.theme.BarlowCond
import pl.wertis.kolektor.ui.theme.BorderCol
import pl.wertis.kolektor.ui.theme.CardWhite
import pl.wertis.kolektor.ui.theme.Ink
import pl.wertis.kolektor.ui.theme.InkMute
import pl.wertis.kolektor.ui.theme.InkSoft

/* ── Zmiana lokalizacji: skan towaru → skan etykiety regału ─────────────────
   Auto-zapis bez tapa: skan etykiety półki od razu zapisuje lokalizację;
   przy >1 lokalizacjach arkusz zastąp/dodaj/zastąp jedną. EAN przechodzi
   do fallbacku (karta innego towaru).

   DWA TRYBY, bo to dwie różne intencje i mylenie ich kosztuje adres:
   PRZENIEŚ (domyślny) zastępuje, DODAJ dokłada kolejny. Wcześniej istniał
   wyłącznie pierwszy, a arkusz z opcją „DODAJ JAKO KOLEJNĄ" otwierał się
   dopiero przy DWÓCH adresach — czyli przy stanie, do którego nie dało się
   dojść, bo drugiego adresu nie było jak nadać. Towar z jednym adresem był
   więc trwale jednoadresowy.                                                 */

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ScanLocScreen(graph: AppGraph) {
    val id = graph.nav.curId ?: return
    val dodaj = graph.nav.scanLocDodaj
    val scope = rememberCoroutineScope()

    val seed = remember(id) { graph.cards.peekCard(id) }
    val poll by remember(id) {
        pollFlow(2000, initial = seed) {
            apiCall { graph.api.product(id) }.also { graph.cards.putCard(it) }
        }
    }.collectAsState(initial = Poll(seed, loading = seed == null))
    // znana reguła od razu — walidacja skanu półki nie czeka na sieć
    val locInfo by produceState(graph.locationsRepo.cached()) { value = graph.locationsRepo.get() }

    var manualOpen by remember { mutableStateOf(false) }
    var manual by remember { mutableStateOf("") }
    var pending by remember { mutableStateOf<String?>(null) }
    var saving by remember { mutableStateOf(false) }
    /* Skan, który przyszedł ZANIM karta dojechała. `handleCode` musi znać
       obecne adresy towaru, więc bez karty nie ma jak rozstrzygnąć — ale
       połknięcie skanu bez śladu to zapisany donikąd adres w głowie człowieka,
       który już odszedł od regału. Kod czeka i odpala się, gdy karta jest. */
    var queuedScan by remember(id) { mutableStateOf<String?>(null) }

    val p = poll.data

    /** Auto-zapis i powrót na kartę. */
    fun save(choice: LocChoice) {
        if (saving) return
        saving = true
        scope.launch {
            try {
                saveLocation(graph, id, choice, locInfo)
                pending = null
                graph.nav.go(Screen.PRODUCT)
            } catch (e: Exception) {
                graph.effects.toast(e.message ?: "Błąd zapisu")
            } finally {
                saving = false
            }
        }
    }

    fun handleCode(raw: String) {
        val card = p ?: run {
            queuedScan = raw
            return
        }
        val code = normalizeLoc(raw)
        val err = validateLoc(code, locInfo)
        if (err != null) {
            graph.effects.toast(err)
            graph.feedback.beep(false)
            return
        }
        if (code in card.locs) {
            graph.effects.toast("Towar już ma lokalizację $code")
            graph.feedback.beep(false)
            return
        }
        // Tryb DODAJ jest jednoznaczny — człowiek zadeklarował intencję,
        // wchodząc tu przyciskiem, więc nie ma o co pytać drugi raz.
        if (dodaj) {
            save(LocChoice(LocAction.ADD, code))
            return
        }
        if (card.locs.size > 1) {
            pending = code // realna decyzja — arkusz zostaje
            return
        }
        save(LocChoice(LocAction.REPLACE, code))
    }

    ScanHandlerEffect { scan ->
        if (scan.kind == ScanKind.EAN) return@ScanHandlerEffect false // EAN → fallback
        handleCode(scan.code)
        true
    }

    // odczekany skan odpala się, gdy tylko karta dojedzie
    LaunchedEffect(p != null) {
        if (p != null) queuedScan?.let { queuedScan = null; handleCode(it) }
    }

    if (p == null) {
        LoadingRow()
        return
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        // Tożsamość towaru — magazynier musi wiedzieć CO przenosi
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(10.dp))
                .border(1.dp, BorderCol, RoundedCornerShape(10.dp))
                .background(CardWhite)
                .padding(horizontal = 12.dp, vertical = 10.dp),
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Column(Modifier.weight(1f)) {
                    Text(p.name, fontWeight = FontWeight.Bold, fontSize = 14.sp, color = Ink)
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.padding(top = 3.dp)) {
                        Text(p.sym, fontFamily = BarlowCond, fontWeight = FontWeight.Bold, fontSize = 15.sp, color = Ink)
                        Text("EAN ${p.ean.ifEmpty { "—" }}", fontSize = 12.sp, color = InkSoft)
                        Text(p.unit, fontSize = 12.sp, color = InkSoft)
                    }
                }
                /* Po prawej, żeby nazwa została flush-left jak dotąd.
                   Z powiększeniem — „magazynier musi wiedzieć CO przenosi",
                   a karta tożsamości nie ma tu innego gestu. */
                MiniaturaTowaru(graph, p.id, 56.dp, powieksz = true)
            }
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
                modifier = Modifier.padding(top = 6.dp),
            ) {
                Text("TERAZ:", fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.sp, color = InkMute, modifier = Modifier.align(Alignment.CenterVertically))
                if (p.locs.isEmpty()) {
                    Text("brak lokalizacji", fontSize = 13.sp, color = InkMute)
                } else {
                    p.locs.forEachIndexed { i, c ->
                        Text(
                            c,
                            fontFamily = BarlowCond,
                            fontWeight = FontWeight.Bold,
                            fontSize = 13.sp,
                            color = if (i == 0) Color.White else Ink,
                            modifier = Modifier
                                .clip(RoundedCornerShape(50))
                                .border(1.5.dp, Ink, RoundedCornerShape(50))
                                .background(if (i == 0) Ink else CardWhite)
                                .padding(horizontal = 10.dp, vertical = 2.dp),
                        )
                    }
                }
            }
        }

        Text(
            if (dodaj) {
                "Podejdź do NOWEGO miejsca i zeskanuj jego etykietę — adres " +
                    "dojdzie do listy, dotychczasowe zostają."
            } else {
                "Podejdź do miejsca docelowego i zeskanuj jego etykietę — zapis nastąpi od razu."
            },
            fontSize = 13.sp,
            color = InkSoft,
        )

        // strefa „czekam na skan”
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(14.dp))
                .border(2.dp, Amber, RoundedCornerShape(14.dp))
                .background(AmberBgSoft)
                .padding(vertical = 24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text("▮▮▯▮▯▮▮", fontSize = 22.sp, color = Ink)
            Text(
                "ZESKANUJ ETYKIETĘ LOKALIZACJI",
                fontFamily = BarlowCond,
                fontWeight = FontWeight.Bold,
                fontSize = 16.sp,
                letterSpacing = 1.sp,
                color = Ink,
            )
            Text("czekam na skan…", fontSize = 11.sp, color = InkMute)
        }

        if (locInfo?.allowManual != false) {
            if (!manualOpen) {
                Text(
                    "Wpisz lokalizację ręcznie…",
                    fontSize = 13.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = AmberDark,
                    textAlign = TextAlign.Center,
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { manualOpen = true }
                        .padding(6.dp),
                )
            } else {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        WertisTextField(
                            value = manual,
                            onValueChange = { manual = it.uppercase() },
                            placeholder = "np. E08-03-01",
                            modifier = Modifier.weight(1f),
                            onDone = { handleCode(manual) },
                        )
                        PrimaryButton("OK") { handleCode(manual) }
                    }
                    Text("Bez spacji · ręczne wpisywanie = ryzyko literówek", fontSize = 11.sp, color = InkMute)
                }
            }
        }
    }

    LocChoiceSheet(product = p, code = pending, onClose = { pending = null }, onPick = ::save)
}
