package pl.wertis.kolektor.ui.przesuniecie

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import pl.wertis.kolektor.AppGraph
import pl.wertis.kolektor.core.net.MagazynInfo
import pl.wertis.kolektor.core.net.PrzesuniecieBody
import pl.wertis.kolektor.core.przesuniecie.przesuniecieBlocker
import pl.wertis.kolektor.core.przesuniecie.pytamyOPolke
import pl.wertis.kolektor.core.loc.normalizeLoc
import pl.wertis.kolektor.core.scan.ScanKind
import pl.wertis.kolektor.core.text.formatQty
import pl.wertis.kolektor.net.apiCall
import pl.wertis.kolektor.scan.ScanHandlerEffect
import pl.wertis.kolektor.ui.components.OutlineButton
import pl.wertis.kolektor.ui.components.PrimaryButton
import pl.wertis.kolektor.ui.components.WIcons
import pl.wertis.kolektor.ui.components.WertisTextField
import pl.wertis.kolektor.ui.theme.Amber
import pl.wertis.kolektor.ui.theme.AmberBg
import pl.wertis.kolektor.ui.theme.AmberInk
import pl.wertis.kolektor.ui.theme.AmberLine
import pl.wertis.kolektor.ui.theme.BarlowCond
import pl.wertis.kolektor.ui.theme.CardBorder
import pl.wertis.kolektor.ui.theme.CardWhite
import pl.wertis.kolektor.ui.theme.Destructive
import pl.wertis.kolektor.ui.theme.Ink
import pl.wertis.kolektor.ui.theme.InkMute
import pl.wertis.kolektor.ui.theme.InkSoft
import pl.wertis.kolektor.ui.theme.Paper
import pl.wertis.kolektor.ui.theme.cardSurface

/* ── Przesunięcie stanu między magazynami (0.22.0) ───────────────────────────
   Zastąpiło całą sesję z wózkiem. Zamiast rundy po kontenerze jest jedna
   czynność: przesuń tyle a tyle sztuk z magazynu do magazynu.

   ARKUSZ, NIE EKRAN — i to nie jest oszczędność. Przesunięcie wychodzi
   z trzech miejsc (kafel magazynu, podlinijka MGP na karcie, wiersz dostawy),
   a `NavModel` to statyczna mapa POWROTÓW, nie stos: ekran o trzech rodzicach
   wymagałby drugiego wyjątku obok `queueReturn`. Arkusz zostawia pod spodem
   kontekst, z którego wyszedł, więc tożsamość towaru jest na ekranie za darmo.

   BEZ BUFORA OFFLINE, świadomie inaczej niż `SaveLocation.kt`. Bufor
   przechowuje intencję, a walidacja „dostępne minus w drodze" liczy się na
   serwerze W CHWILI ZAPISU. Operacja odbuforowana za dwie godziny zbudowałaby
   dokument MM na stan, którego już nie ma — i odmowa przyszłaby cicho, do
   pliku, bez człowieka przy palecie.                                          */

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PrzesuniecieSheet(
    graph: AppGraph,
    twId: Long,
    sym: String,
    name: String,
    unit: String,
    /**
     * Magazyn źródłowy. Kafel magazynu bez roli zna swój `magId`; kafel MGP
     * i wiersz ZWROTY znają tylko ROLĘ, bo identyfikatory ról siedzą
     * w konfiguracji serwera i kolektor ich nie zna. Podaje się jedno albo
     * drugie — rolę rozwiązuje lista magazynów, którą arkusz i tak pobiera.
     */
    magFrom: Long? = null,
    magFromRola: String? = null,
    /** Stan źródła POMNIEJSZONY o to, co już czeka w kolejce. */
    dostepne: Double,
    /** Ilość wypełniona z góry (skrót z wiersza dostawy); null = puste pole. */
    qtyInit: Double? = null,
    /** Pozycja dostawy — serwer odłoży ją przy okazji przesunięcia. */
    lineId: Long? = null,
    onDone: () -> Unit,
    onCancel: () -> Unit,
) {
    val scope = rememberCoroutineScope()

    var magazynyWszystkie by remember { mutableStateOf<List<MagazynInfo>>(emptyList()) }
    var magazyny by remember { mutableStateOf<List<MagazynInfo>>(emptyList()) }
    var zrodlo by remember { mutableStateOf(magFrom) }
    var magMag by remember { mutableStateOf<Long?>(null) }
    var magTo by remember { mutableStateOf<Long?>(null) }
    var qty by remember { mutableStateOf(qtyInit?.let { formatQty(it) } ?: "") }
    var location by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }

    /* Listę magazynów bierzemy z serwera, bo to on rozstrzyga o rolach
       i ukrywaniu — kolektor niczego nie filtruje, tylko rysuje to, co dostał.
       Przez repozytorium: przy ciepłym cache arkusz otwiera się z wyborami
       od razu, zamiast czekać na sieć z pustymi selektorami. */
    LaunchedEffect(Unit) {
        val lista = graph.magazynyRepo.get() ?: emptyList()
        magazynyWszystkie = lista
        val z = magFrom ?: lista.firstOrNull { it.rola == magFromRola }?.magId
        zrodlo = z
        magazyny = lista.filter { !it.ukryty && it.magId != z }
        magMag = lista.firstOrNull { it.rola == "MAG" }?.magId
        // MAG na wierzchu i wybrany z góry: to cel każdego realnego przesunięcia
        magTo = magMag ?: magazyny.firstOrNull()?.magId
    }

    val zrodloKod = magazynyWszystkie.firstOrNull { it.magId == zrodlo }?.kod
    val hala = magMag
    val qtyValue = qty.replace(',', '.').toDoubleOrNull()
    val pytamy = hala != null && pytamyOPolke(magTo, hala)
    val blocker = hala?.let {
        przesuniecieBlocker(zrodlo, magTo, qtyValue, dostepne, location, it)
    }

    /* Skan półki. `ScannerBus` to stos, więc ostatnio zarejestrowany handler
       wygrywa — arkusz przejmuje skan nad ekranem, który go otworzył. */
    ScanHandlerEffect { scan ->
        if (!pytamy) return@ScanHandlerEffect false
        if (scan.kind == ScanKind.EAN) return@ScanHandlerEffect false
        location = normalizeLoc(scan.code)
        graph.feedback.beep(true)
        true
    }

    fun wyslij() {
        /* Trzy wartości wyjmujemy ZANIM cokolwiek poleci — `blocker` już
           sprawdził, że są, ale kompilator o tym nie wie, a wymuszanie ich
           wykrzyknikiem znaczyłoby, że reguła i zapis mogą się rozjechać po
           cichu. Tu rozjazd jest po prostu brakiem wysyłki. */
        val ile = qtyValue
        val skad = zrodlo
        val dokad = magTo
        if (blocker != null || busy || ile == null || skad == null || dokad == null) return
        busy = true
        scope.launch {
            try {
                apiCall {
                    graph.api.przesun(
                        PrzesuniecieBody(
                            twId = twId,
                            qty = ile,
                            magFrom = skad,
                            magTo = dokad,
                            location = location.takeIf { pytamy },
                            lineId = lineId,
                        )
                    )
                }
                graph.feedback.beep(true)
                graph.queueRepo.refreshNow()
                val kod = magazyny.firstOrNull { it.magId == dokad }?.kod ?: ""
                graph.effects.toast("Przesunięto ${formatQty(ile)} $unit → $kod")
                onDone()
            } catch (e: Exception) {
                graph.feedback.beep(false)
                graph.effects.toast(e.message ?: "Nie udało się przesunąć")
            } finally {
                busy = false
            }
        }
    }

    ModalBottomSheet(onDismissRequest = onCancel, containerColor = Paper) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 14.dp)
                .padding(bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Icon(WIcons.Box, null, tint = AmberInk, modifier = Modifier.size(20.dp))
                Text(
                    "Przesuń stan",
                    fontFamily = BarlowCond,
                    fontWeight = FontWeight.ExtraBold,
                    fontSize = 20.sp,
                    color = Ink,
                )
            }

            Column(Modifier.fillMaxWidth().cardSurface().padding(horizontal = 12.dp, vertical = 9.dp)) {
                Text(sym, fontFamily = BarlowCond, fontWeight = FontWeight.Bold, fontSize = 15.sp, color = Ink)
                Text(name, fontSize = 12.sp, color = InkSoft, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Text(
                    "${formatQty(dostepne)} $unit dostępne w ${zrodloKod ?: "źródle"}",
                    fontSize = 11.5.sp,
                    color = InkMute,
                )
            }

            Text("Dokąd?", fontSize = 12.5.sp, color = InkSoft)
            magazyny.chunked(2).forEach { rzad ->
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    rzad.forEach { m ->
                        MagTile(m, selected = m.magId == magTo, modifier = Modifier.weight(1f)) {
                            magTo = m.magId
                            // zmiana celu czyści skan: kod z poprzedniego wyboru
                            // poleciałby cicho w żądaniu i trafił w złą kartotekę
                            location = null
                        }
                    }
                    if (rzad.size == 1) Box(Modifier.weight(1f))
                }
            }

            WertisTextField(
                value = qty,
                onValueChange = { qty = it.filter { c -> c.isDigit() || c == ',' || c == '.' } },
                placeholder = "Ile sztuk",
                keyboardType = KeyboardType.Number,
                modifier = Modifier.fillMaxWidth(),
            )

            /* Adres w kartotece Subiekta to JEDNO pole na towar, bez wymiaru
               magazynu — opisuje regał na hali. Przy innym celu nie ma czego
               skanować i trzeba to powiedzieć, zamiast po cichu chować pole. */
            if (pytamy) {
                SkanPolki(location)
            } else if (magTo != null) {
                Text(
                    "Adres w kartotece opisuje regał na hali, więc przy tym magazynie nie ma czego zeskanować.",
                    fontSize = 11.5.sp,
                    color = InkMute,
                )
            }

            blocker?.let {
                Text(it, fontSize = 12.5.sp, fontWeight = FontWeight.SemiBold, color = Destructive)
            }

            PrimaryButton(
                text = if (busy) "PRZESUWAM…" else "PRZESUŃ",
                enabled = blocker == null && !busy,
                tall = true,
                modifier = Modifier.fillMaxWidth(),
                onClick = { wyslij() },
            )
            OutlineButton("ANULUJ", modifier = Modifier.fillMaxWidth(), enabled = !busy, onClick = onCancel)
        }
    }
}

@Composable
private fun MagTile(m: MagazynInfo, selected: Boolean, modifier: Modifier, onClick: () -> Unit) {
    Column(
        modifier = modifier
            .clip(RoundedCornerShape(12.dp))
            .background(if (selected) AmberBg else CardWhite)
            .border(if (selected) 2.dp else 1.dp, if (selected) Amber else CardBorder, RoundedCornerShape(12.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 10.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Text(
            m.kod,
            fontFamily = BarlowCond,
            fontWeight = FontWeight.Bold,
            fontSize = 15.sp,
            color = if (selected) AmberInk else Ink,
        )
        if (m.nazwa.isNotBlank()) {
            Text(m.nazwa, fontSize = 10.5.sp, color = InkMute, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

/** Strefa skanu — ten sam wzorzec co na ekranie zmiany lokalizacji. */
@Composable
private fun SkanPolki(kod: String?) {
    Box(
        Modifier
            .fillMaxWidth()
            .height(if (kod == null) 88.dp else 64.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(AmberBg)
            .border(1.dp, AmberLine, RoundedCornerShape(12.dp)),
        contentAlignment = Alignment.Center,
    ) {
        if (kod == null) {
            Text(
                "ZESKANUJ ETYKIETĘ PÓŁKI",
                fontFamily = BarlowCond,
                fontWeight = FontWeight.Bold,
                fontSize = 15.sp,
                color = AmberInk,
            )
        } else {
            Text(
                kod,
                fontFamily = BarlowCond,
                fontWeight = FontWeight.ExtraBold,
                fontSize = 22.sp,
                color = AmberInk,
            )
        }
    }
}
