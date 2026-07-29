package pl.wertis.kolektor.ui.product

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import pl.wertis.kolektor.AppGraph
import pl.wertis.kolektor.core.loc.validateLoc
import pl.wertis.kolektor.core.net.LocAction
import pl.wertis.kolektor.core.net.MagazynStan
import pl.wertis.kolektor.core.net.LocationsInfo
import pl.wertis.kolektor.core.net.MovementEntry
import pl.wertis.kolektor.core.net.SetLocationBody
import pl.wertis.kolektor.core.net.WDostawie
import pl.wertis.kolektor.core.net.ZamowioneUDostawcy
import pl.wertis.kolektor.core.scan.ScanKind
import pl.wertis.kolektor.data.Poll
import pl.wertis.kolektor.data.pollFlow
import pl.wertis.kolektor.net.apiCall
import pl.wertis.kolektor.scan.ScanHandlerEffect
import pl.wertis.kolektor.data.RecentEntry
import pl.wertis.kolektor.ui.components.LoadingRow
import pl.wertis.kolektor.ui.components.LocChip
import pl.wertis.kolektor.ui.components.LocState
import pl.wertis.kolektor.ui.components.OutlineButton
import pl.wertis.kolektor.ui.components.ProductRowCard
import pl.wertis.kolektor.ui.components.SectionLabel
import pl.wertis.kolektor.ui.components.WIcons
import pl.wertis.kolektor.ui.components.formatQty
import pl.wertis.kolektor.ui.product.LocChoice
import pl.wertis.kolektor.ui.product.LocChoiceSheet
import pl.wertis.kolektor.ui.theme.AmberBg
import pl.wertis.kolektor.ui.theme.AmberBgSoft
import pl.wertis.kolektor.ui.theme.AmberInk
import pl.wertis.kolektor.ui.theme.AmberLine
import pl.wertis.kolektor.ui.theme.BarlowCond
import pl.wertis.kolektor.ui.theme.BorderCol
import pl.wertis.kolektor.ui.theme.CardBorder
import pl.wertis.kolektor.ui.theme.CardWhite
import pl.wertis.kolektor.ui.theme.Ink
import pl.wertis.kolektor.ui.theme.InkMute
import pl.wertis.kolektor.ui.theme.InkSoft
import pl.wertis.kolektor.ui.theme.Secondary
import pl.wertis.kolektor.ui.theme.cardSurface

/* ── Karta towaru — port web/src/screens/Product.tsx ────────────────────────
   Intencja z kolejności skanów: na karcie skan etykiety regału = przenieś TEN
   towar TAM (przy >1 lokalizacjach — arkusz zastąp/dodaj/zastąp jedną);
   skan EAN przechodzi do fallbacku (karta kolejnego towaru).                 */

private const val LOC_LIMIT = 50

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ProductScreen(graph: AppGraph) {
    // przez flow, nie przez pole: bez tego wejście w zamiennik zmienia `curId`,
    // a ekran zostaje na starym towarze (patrz komentarz w AppNavState)
    val id = graph.nav.curIdFlow.collectAsState().value ?: return
    val scope = rememberCoroutineScope()

    val poll by remember(id) {
        pollFlow(2000) { apiCall { graph.api.product(id) } }
    }.collectAsState(initial = Poll())
    val history by produceState<List<MovementEntry>>(emptyList(), id) {
        value = try {
            apiCall { graph.api.history(id) }.entries
        } catch (_: Exception) {
            emptyList()
        }
    }
    val locInfo by produceState<LocationsInfo?>(null) { value = graph.locationsRepo.get() }

    var chipMenu by remember(id) { mutableStateOf<String?>(null) }
    // skan przy wielu lokalizacjach — także ten z trybu przypiętego, który
    // przyprowadził nas na tę kartę właśnie po rozstrzygnięcie
    /* Półka zeskanowana przy towarze mającym ≥2 adresy — wtedy ZASTĄP/DODAJ
       jest realną decyzją człowieka i arkusz otwiera się tutaj, gdzie widać
       wszystkie adresy naraz. */
    var pendingLoc by remember(id) { mutableStateOf<String?>(null) }
    var saving by remember { mutableStateOf(false) }

    val p = poll.data

    /** Zapis relokacji ze skanu (wspólny zapis — SaveLocation.kt). */
    fun saveLoc(choice: LocChoice) {
        if (saving) return
        saving = true
        scope.launch {
            try {
                saveLocation(graph, id, choice, locInfo)
                pendingLoc = null
            } catch (e: Exception) {
                graph.effects.toast(e.message ?: "Błąd zapisu")
            } finally {
                saving = false
            }
        }
    }

    ScanHandlerEffect { scan ->
        val card = p
        if (card == null || scan.kind != ScanKind.LOC) return@ScanHandlerEffect false
        val err = validateLoc(scan.code, locInfo)
        when {
            err != null -> {
                graph.effects.toast(err)
                graph.feedback.beep(false)
            }
            scan.code in card.locs -> graph.effects.toast("Towar już ma lokalizację ${scan.code}")
            card.locs.size > 1 -> pendingLoc = scan.code
            else -> saveLoc(LocChoice(LocAction.REPLACE, scan.code))
        }
        true
    }

    if (p == null) {
        LoadingRow("Wczytywanie karty…")
        return
    }

    val locStr = p.locs.joinToString(" ")
    val hasPendingMM = p.mgp.pendingOut > 0

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        // nagłówek
        Column {
            Text(p.name, fontWeight = FontWeight.Bold, fontSize = 16.sp, color = Ink, lineHeight = 20.sp)
            // Symbol to jedyny identyfikator, którym magazynier posługuje się przy
            // regale (nazwy się powtarzają, EAN-u nie da się przeczytać z ręki) —
            // dlatego własny wiersz i rozmiar nagłówka, a nie linijka metadanych.
            Text(
                p.sym,
                fontFamily = BarlowCond,
                fontWeight = FontWeight.ExtraBold,
                fontSize = 26.sp,
                lineHeight = 28.sp,
                color = Ink,
                modifier = Modifier.padding(top = 2.dp),
            )
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("EAN ${p.ean.ifEmpty { "—" }}", fontSize = 12.sp, color = InkSoft)
                Text(p.unit, fontSize = 12.sp, color = InkSoft)
            }
            if (p.desc.isNotEmpty()) {
                Text(p.desc, fontSize = 11.5.sp, color = InkMute, maxLines = 2, modifier = Modifier.padding(top = 4.dp))
            }
        }

        // stany MAG / MGP / Zwroty
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            StockCard(
                label = "MAG · DOSTĘPNE",
                value = p.mag.avail,
                sub = "rez. ${formatQty(p.mag.rez)} · razem ${formatQty(p.mag.stan)}",
                highlight = false,
                unit = p.unit,
                modifier = Modifier.weight(1f),
            )
            StockCard(
                label = "MGP · STREFA PRZYJĘĆ",
                value = p.mgp.stan,
                /* Był tu trzeci wariant „zam. u dostawcy: N" z pola `ordered`.
                   Zniknął razem z tym polem: importer produkcyjny wpisywał w nie
                   zero na sztywno, więc napis nie zapalił się nigdy poza demem.
                   Zamówienia mają teraz własną sekcję niżej — z dostawcą
                   i terminem, czyli tym, o co magazynier faktycznie pyta. */
                sub = if (p.mgp.stan > 0) "do zasilenia MAG" else "strefa przyjęć pusta",
                highlight = p.mgp.stan > 0,
                unit = p.unit,
                modifier = Modifier.weight(1f),
            )
        }
        if ((p.zwroty?.stan ?: 0.0) > 0) {
            StockCard(
                label = "ZWROTY OD KLIENTÓW",
                value = p.zwroty!!.stan,
                sub = "czeka na rozłożenie (karton zwrotów)",
                highlight = true,
                unit = p.unit,
                modifier = Modifier.fillMaxWidth(),
            )
        }

        /* „Stan mówi 12, a półka pusta" — sekcja stoi TUTAJ, bo odpowiada na
           pytanie postawione przez kafel wyżej, a nie jest osobnym krokiem
           pracy. Przy dostawie krajowej towar figuruje na MAG od chwili
           zaksięgowania dokumentu, więc kafel nie odróżnia „leży w regale"
           od „stoi na palecie w przyjęciach". */
        if (p.wDostawie.isNotEmpty()) {
            WDostawieSekcja(p.wDostawie, p.unit)
        }

        /* Druga połowa tego samego pytania. Sekcja wyżej mówi „jest u nas,
           poszukaj w przyjęciach"; ta mówi „nie ma i trzeba poczekać". Stoi
           NIŻEJ, bo kolejność jest tu treścią: najpierw to, co magazynier może
           znaleźć dzisiaj, potem to, na co nie ma wpływu. */
        if (p.zamowione.isNotEmpty()) {
            ZamowioneSekcja(p.zamowione, p.unit)
        }

        /* Pozostałe magazyny firmy. Trzy kafle wyżej mają własną semantykę
           (MAG = dostępne, MGP = do zasilenia, Zwroty = do rozłożenia), więc
           te idą osobno i kompaktowo — to informacja pomocnicza, nie kolejny
           krok pracy. Które magazyny tu wchodzą, rozstrzyga serwer; ukrywanie
           jest globalne (Ustawienia → MAGAZYNY). */
        if (p.magazyny.isNotEmpty()) {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(
                    "POZOSTAŁE MAGAZYNY",
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Bold,
                    letterSpacing = 1.sp,
                    color = InkMute,
                )
                p.magazyny.forEach { m -> MagazynRow(m, p.unit) }
            }
        }

        if (hasPendingMM) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(10.dp))
                    .border(1.dp, AmberLine, RoundedCornerShape(10.dp))
                    .background(AmberBgSoft)
                    .padding(horizontal = 10.dp, vertical = 7.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(7.dp),
            ) {
                Icon(WIcons.Clock, null, tint = AmberInk, modifier = Modifier.size(16.dp))
                Text(
                    "W kolejce Sfery ${formatQty(p.mgp.pendingOut)} szt — stan uwzględni zapis za chwilę",
                    fontSize = 12.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = AmberInk,
                )
            }
        }

        // lokalizacje
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Bottom) {
                Text(
                    "LOKALIZACJE (pierwsza = pickingowa)",
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Bold,
                    letterSpacing = 1.sp,
                    color = InkMute,
                    modifier = Modifier.weight(1f),
                )
                Text(
                    "${locStr.length}/$LOC_LIMIT zn.",
                    fontSize = 10.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = if (locStr.length > 42) MaterialTheme.colorScheme.error else InkMute,
                )
            }
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                if (p.locs.isEmpty()) {
                    Text(
                        "brak lokalizacji",
                        fontSize = 13.sp,
                        color = InkMute,
                        modifier = Modifier
                            .clip(RoundedCornerShape(50))
                            .border(1.5.dp, BorderCol, RoundedCornerShape(50))
                            .padding(horizontal = 12.dp, vertical = 7.dp),
                    )
                }
                p.locs.forEachIndexed { i, code ->
                    // lokalizacja potwierdzona, chyba że w kolejce czeka jej usunięcie
                    val zmiana = p.pendingLocs.find { it.code == code }
                    LocChip(
                        code,
                        primary = i == 0,
                        state = when {
                            zmiana == null -> LocState.CONFIRMED
                            zmiana.status == "error" -> LocState.FAILED
                            else -> LocState.REMOVING
                        },
                    ) {
                        if (zmiana?.status == "error") graph.nav.openQueue()
                        else chipMenu = if (chipMenu == code) null else code
                    }
                }
                // lokalizacje DOCHODZĄCE nie są jeszcze w `locs` — bez tego skan
                // wyglądałby, jakby nic nie zrobił
                p.pendingLocs.filter { it.kind == "add" }.forEach { zmiana ->
                    LocChip(
                        zmiana.code,
                        primary = false,
                        state = if (zmiana.status == "error") LocState.FAILED else LocState.ADDING,
                    ) { graph.nav.openQueue() }
                }
                /* DOŁOŻENIE ADRESU stoi w rzędzie chipów, a nie w przycisku pod
                   spodem, bo to operacja NA TEJ LIŚCIE — obok adresów, które
                   zostają. Przycisk „ZMIEŃ LOKALIZACJĘ" niżej robi co innego
                   (zastępuje) i mylenie tych dwóch kosztuje adres. */
                Text(
                    "+ DODAJ",
                    fontFamily = BarlowCond,
                    fontWeight = FontWeight.Bold,
                    fontSize = 13.sp,
                    color = AmberInk,
                    modifier = Modifier
                        .clip(RoundedCornerShape(50))
                        .border(1.5.dp, AmberLine, RoundedCornerShape(50))
                        .background(AmberBgSoft)
                        .clickable { graph.nav.openScanLoc(dodaj = true) }
                        .padding(horizontal = 12.dp, vertical = 7.dp),
                )
            }
            if (p.pendingLocs.isNotEmpty()) {
                val blad = p.pendingLocs.any { it.status == "error" }
                Text(
                    if (blad) "Zapis do Subiekta nie powiódł się — dotknij, żeby otworzyć kolejkę"
                    else "⏳ czeka na zapis w Subiekcie",
                    fontSize = 11.5.sp,
                    fontWeight = if (blad) FontWeight.SemiBold else FontWeight.Normal,
                    color = if (blad) MaterialTheme.colorScheme.error else InkMute,
                )
            }
            chipMenu?.let { code ->
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(10.dp))
                        .border(1.dp, BorderCol, RoundedCornerShape(10.dp))
                        .background(CardWhite)
                        .padding(horizontal = 10.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Text("Lokalizacja", fontSize = 13.sp, color = Ink, modifier = Modifier.weight(1f))
                    Text(code, fontSize = 13.sp, fontWeight = FontWeight.Bold, color = Ink)
                    OutlineButton("USUŃ", danger = true, enabled = !saving) {
                        scope.launch {
                            try {
                                apiCall { graph.api.setLocation(id, SetLocationBody(LocAction.REMOVE, value = code)) }
                                graph.queueRepo.refreshNow()
                                chipMenu = null
                                /* Bez nakładki — chip przechodzi w REMOVING
                                   i sam znika, gdy Subiekt potwierdzi. Ale
                                   stan chipa bierze się z odpowiedzi serwera,
                                   więc dochodzi dopiero z odpytaniem (2 s);
                                   beep potwierdza SAM TAP od razu, żeby ta
                                   sekunda nie wyglądała jak martwy przycisk. */
                                graph.feedback.beep(true)
                            } catch (e: Exception) {
                                graph.effects.toast(e.message ?: "Błąd zapisu")
                            }
                        }
                    }
                    Icon(
                        WIcons.Close,
                        contentDescription = "Zamknij",
                        tint = InkMute,
                        modifier = Modifier.clickable { chipMenu = null }.padding(4.dp).size(18.dp),
                    )
                }
            }
        }

        Spacer(Modifier.height(2.dp))
        Text(
            "skan etykiety regału = przenieś tutaj · „+ DODAJ” = dołóż adres · " +
                "skan towaru = następna karta",
            fontSize = 11.sp,
            color = InkMute,
            modifier = Modifier.fillMaxWidth(),
            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
        )

        // MM ad-hoc wycięte (wywiad): przesunięcia robi tryb B (wózek) albo biuro.
        // Karta towaru zapisuje wyłącznie lokalizację.
        OutlineButton("ZMIEŃ LOKALIZACJĘ", tall = true, leadingIcon = WIcons.Pin, modifier = Modifier.fillMaxWidth()) {
            graph.nav.openScanLoc()
        }

        /* Zamienniki — wyczytane z opisu przez serwer (services/zamienniki.ts).
           Pytanie „czym to zastąpić?" pada dopiero wtedy, gdy stan nie wystarcza,
           więc sekcja stoi pod przyciskiem, a nie nad lokalizacjami: codzienna
           ścieżka to stany → lokalizacje → ZMIEŃ LOKALIZACJĘ i ona zostaje na
           swoim miejscu. Sekcja pokazuje się na ~1 karcie na 5. */
        if (p.zamienniki.znane.isNotEmpty() || p.zamienniki.obce.isNotEmpty()) {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                SectionLabel("Zamienniki")
                p.zamienniki.znane.forEach { row ->
                    ProductRowCard(row) {
                        graph.nav.openProduct(
                            row.id,
                            RecentEntry(row.id, row.sym, row.locs.firstOrNull() ?: "brak lokalizacji"),
                        )
                    }
                }
                if (p.zamienniki.obce.isNotEmpty()) {
                    // numerów obcych nie mamy u siebie — nie ma dokąd w nie wejść,
                    // ale to one idą w rozmowę z dostawcą
                    Text(
                        "Numery obce: " + p.zamienniki.obce.joinToString(" · "),
                        fontSize = 11.5.sp,
                        color = InkMute,
                        lineHeight = 15.sp,
                    )
                }
            }
        }

        // Historia (ostatnie 4) — na samym dole, bo sięga się po nią dopiero, gdy
        // coś się nie zgadza („kto to ruszył?"). Codzienna ścieżka to stany,
        // lokalizacje i zmiana lokalizacji — te muszą być nad zgięciem ekranu.
        if (history.isNotEmpty()) {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                SectionLabel("Historia")
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .cardSurface()
                        .padding(horizontal = 10.dp, vertical = 8.dp),
                    verticalArrangement = Arrangement.spacedBy(3.dp),
                ) {
                    history.take(4).forEach { h ->
                        Row {
                            Text(
                                h.detail.ifEmpty { h.type },
                                fontSize = 11.5.sp,
                                color = InkSoft,
                                maxLines = 1,
                                modifier = Modifier.weight(1f),
                            )
                            Text(
                                "${h.user} · ${h.at.drop(5).take(5)} ${h.at.drop(11).take(5)}",
                                fontSize = 11.sp,
                                color = InkMute,
                            )
                        }
                    }
                }
            }
        }
    }

    LocChoiceSheet(
        product = p,
        code = pendingLoc,
        onClose = { pendingLoc = null },
        onPick = ::saveLoc,
    )
}

/**
 * Jeden magazyn bez roli: kod, nazwa i stan w jednej linii.
 *
 * Świadomie NIE jest to `StockCard` — te kafle mają 36 sp cyfry i zajmują pół
 * ekranu, bo niosą decyzję („ile odłożyć"). Tu chodzi o odpowiedź na pytanie
 * pomocnicze, więc wiersz ma być wąski nawet przy ośmiu magazynach.
 *
 * Zerowy stan zostaje WIDOCZNY, tylko przygaszony: zgłoszenie mówiło
 * o wszystkich magazynach, a od chowania jest osobne ustawienie. Milczące
 * odsiewanie zer kazałoby się domyślać, czy magazyn jest pusty, czy ukryty.
 */
@Composable
private fun MagazynRow(m: MagazynStan, unit: String) {
    val pusty = m.stan == 0.0
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .cardSurface(background = CardWhite, borderColor = CardBorder)
            .padding(horizontal = 10.dp, vertical = 7.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                m.kod,
                fontSize = 12.sp,
                fontWeight = FontWeight.Bold,
                color = if (pusty) InkMute else Ink,
            )
            if (m.nazwa.isNotBlank()) {
                Text(m.nazwa, fontSize = 11.sp, color = InkMute, maxLines = 1)
            }
        }
        Text(
            formatQty(m.stan),
            fontFamily = BarlowCond,
            fontWeight = FontWeight.ExtraBold,
            fontSize = 20.sp,
            color = if (pusty) InkMute else Ink,
        )
        if (unit.isNotEmpty()) {
            Text(
                unit,
                fontSize = 11.sp,
                fontWeight = FontWeight.SemiBold,
                color = InkMute,
                modifier = Modifier.padding(start = 3.dp),
            )
        }
    }
}

/**
 * „W dostawie, nierozłożone" — czemu stanu nie widać na półce.
 *
 * Sekcja jest NIEKLIKALNA i to jest decyzja, nie niedoróbka. Wejście w dokument
 * z karty towaru musiałoby wołać `openDelivery`, a ta trasa zakłada rozkładanie
 * i przestawia flagę faktury w Subiekcie na „W trakcie sprawdzania". Biuro
 * zobaczyłoby, że ktoś sprawdza fakturę, bo magazynier zajrzał na kartę towaru.
 * Numer dokumentu w zupełności wystarcza, żeby znaleźć paletę.
 */
@Composable
private fun WDostawieSekcja(pozycje: List<WDostawie>, unit: String) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .cardSurface(background = AmberBgSoft, borderColor = AmberLine)
            .padding(horizontal = 10.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(7.dp),
        ) {
            Icon(WIcons.Clock, null, tint = AmberInk, modifier = Modifier.size(16.dp))
            Text(
                "W DOSTAWIE, NIEROZŁOŻONE — ${formatQty(pozycje.sumOf { it.ilosc })}" +
                    if (unit.isNotEmpty()) " $unit" else "",
                fontSize = 11.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = 0.8.sp,
                color = AmberInk,
            )
        }
        pozycje.forEach { d ->
            Text(
                buildString {
                    append(d.nrPelny)
                    append(" · ").append(d.dataWyst)
                    append(" · ").append(formatQty(d.ilosc))
                    if (unit.isNotEmpty()) append(" ").append(unit)
                    // Status mówi, czy ktoś już się o tę pozycję potknął —
                    // milczenie kazałoby szukać towaru, którego nie ma.
                    opisStatusu(d)?.let { append(" · ").append(it) }
                },
                fontSize = 12.sp,
                fontWeight = FontWeight.SemiBold,
                color = AmberInk,
            )
        }
    }
}

/**
 * Otwarte zamówienia u dostawcy.
 *
 * NIEKLIKALNA, tak samo jak sekcja dostaw i z tego samego powodu: nie ma trasy
 * „otwórz zamówienie", a udawane wejście prowadziłoby donikąd.
 *
 * Powierzchnia jest SPOKOJNA, nie bursztynowa, i to jest decyzja. Bursztyn na
 * tym ekranie znaczy „zrób coś teraz" — towar leży w przyjęciach, idź po niego.
 * Zamówienie nie daje żadnej czynności: pozostaje czekać. Ten sam kolor
 * w obu miejscach kazałby magazynierowi szukać towaru, którego w budynku nie ma.
 */
@Composable
private fun ZamowioneSekcja(pozycje: List<ZamowioneUDostawcy>, unit: String) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .cardSurface(background = Secondary, borderColor = BorderCol)
            .padding(horizontal = 10.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(7.dp),
        ) {
            Icon(WIcons.Box, null, tint = InkSoft, modifier = Modifier.size(16.dp))
            Text(
                "ZAMÓWIONE U DOSTAWCY — ${formatQty(pozycje.sumOf { it.ilosc })}" +
                    if (unit.isNotEmpty()) " $unit" else "",
                fontSize = 11.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = 0.8.sp,
                color = InkSoft,
            )
        }
        pozycje.forEach { z ->
            Text(
                buildString {
                    append(z.nrPelny)
                    append(" · ").append(formatQty(z.ilosc))
                    if (unit.isNotEmpty()) append(" ").append(unit)
                    // Termin przed dostawcą: „kiedy" jest pytaniem, „od kogo"
                    // dopowiedzeniem. Bez terminu mówimy to wprost, zamiast
                    // podstawiać datę wystawienia w miejsce obietnicy dostawy.
                    append(" · ").append(z.termin ?: "termin nieznany")
                    if (z.dostawca.isNotEmpty()) append(" · ").append(z.dostawca)
                },
                fontSize = 12.sp,
                fontWeight = FontWeight.SemiBold,
                color = InkSoft,
            )
        }
        /* Jedno zdanie na całą sekcję, nie dopisek przy każdej linii: powód jest
           wspólny (serwer nie umiał odjąć odebranej części), a powtórzony przy
           każdym wierszu zamieniłby się w szum, który przestaje się czytać. */
        if (pozycje.any { it.szacunek }) {
            Text(
                "Ilości są górnym oszacowaniem — serwer nie odjął tego, co już przyjechało.",
                fontSize = 11.sp,
                color = InkMute,
            )
        }
    }
}

/** Dopisek za ilością; `null` gdy nie ma nic do dodania ponad sam fakt dostawy. */
private fun opisStatusu(d: WDostawie): String? = when {
    d.status == "problem" -> "zgłoszony problem"
    d.status == "skipped" -> "pominięte przy rozkładaniu"
    d.status != null -> "rozkładanie w toku"
    d.zwrot -> "zwrot, czeka na rozłożenie"
    d.wBuforze -> "dokument w buforze"
    else -> null
}

@Composable
private fun StockCard(label: String, value: Double, sub: String, highlight: Boolean, unit: String = "", modifier: Modifier = Modifier) {
    Column(
        modifier = modifier
            .cardSurface(
                background = if (highlight) AmberBg else CardWhite,
                borderColor = if (highlight) AmberLine else CardBorder,
            )
            .padding(12.dp),
    ) {
        Text(label, fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.2.sp, color = InkSoft)
        Row(verticalAlignment = Alignment.Bottom) {
            Text(
                formatQty(value),
                fontFamily = BarlowCond,
                fontWeight = FontWeight.ExtraBold,
                fontSize = 36.sp,
                lineHeight = 38.sp,
                color = if (highlight) AmberInk else Ink,
            )
            if (unit.isNotEmpty()) {
                Text(
                    unit,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = InkMute,
                    modifier = Modifier.padding(start = 4.dp, bottom = 5.dp),
                )
            }
        }
        Text(sub, fontSize = 11.sp, color = InkSoft)
    }
}
