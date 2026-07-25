package pl.wertis.kolektor.ui.delivery

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
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
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import pl.wertis.kolektor.AppGraph
import pl.wertis.kolektor.core.loc.normalizeLoc
import pl.wertis.kolektor.core.net.DeliveryLineView
import pl.wertis.kolektor.core.net.DeliveryView
import pl.wertis.kolektor.core.net.EanCandidate
import pl.wertis.kolektor.core.net.KoszykView
import pl.wertis.kolektor.core.net.LocApplyAction
import pl.wertis.kolektor.core.net.PutawayLineBody
import pl.wertis.kolektor.core.net.ScanBody
import pl.wertis.kolektor.core.net.ScanResolution
import pl.wertis.kolektor.core.problem.ProblemType
import pl.wertis.kolektor.core.scan.ScanKind
import pl.wertis.kolektor.net.apiCall
import pl.wertis.kolektor.scan.ScanHandlerEffect
import pl.wertis.kolektor.ui.components.LoadingRow
import pl.wertis.kolektor.ui.components.OutlineButton
import pl.wertis.kolektor.ui.components.SectionLabel
import pl.wertis.kolektor.ui.components.WIcons
import pl.wertis.kolektor.ui.components.WertisTextField
import pl.wertis.kolektor.ui.components.formatQty
import pl.wertis.kolektor.ui.theme.Amber
import pl.wertis.kolektor.ui.theme.AmberBg
import pl.wertis.kolektor.ui.theme.AmberBgSoft
import pl.wertis.kolektor.ui.theme.AmberInk
import pl.wertis.kolektor.ui.theme.AmberLine
import pl.wertis.kolektor.ui.theme.BarlowCond
import pl.wertis.kolektor.ui.theme.CardBorder
import pl.wertis.kolektor.ui.theme.CardWhite
import pl.wertis.kolektor.ui.theme.Destructive
import pl.wertis.kolektor.ui.theme.Ink
import pl.wertis.kolektor.ui.theme.InkMute
import pl.wertis.kolektor.ui.theme.InkSoft
import pl.wertis.kolektor.ui.theme.Success
import pl.wertis.kolektor.ui.theme.cardSurface

/* ── Tryb A: rozkładanie dostawy i zwrotu (redesign §4.2–§4.5) ──────────────
   Ścieżka główna to DWA SKANY na linię i zero tapnięć: skan towaru → karta
   z ilością i lokalizacją docelową → skan etykiety regału → zapis, wibracja,
   powrót do listy. Zero dialogu potwierdzającego.

   Lista posortowana po lokalizacji docelowej (magazynier chodzi alejkami,
   nie w kolejności z faktury), pozycje BEZ lokalizacji w wyróżnionej sekcji
   na końcu — to SKU wymagające decyzji, nie rutyny.

   ZWROT różni się dwiema rzeczami: u góry stoi numer koszyka (wpisany raz,
   dopisywany do każdego odłożenia — koszyki nie mają kodów kreskowych), a po
   opróżnieniu koszyka trzeba go domknąć, żeby powstał MM Zwroty→MAG. Dopóki
   koszyk nie jest domknięty, towar leży na półce, ale w Subiekcie wisi na
   Zwrotach i jest niesprzedawalny — dlatego otwarte koszyki widać na ekranie
   jako osobne przyciski, a nie jako jedno pole „bieżący koszyk".             */

@Composable
fun DeliveryLinesScreen(graph: AppGraph) {
    val id = graph.nav.deliveryId ?: return
    val scope = rememberCoroutineScope()
    var reload by remember { mutableStateOf(0) }

    val view by produceState<DeliveryView?>(null, id, reload) {
        value = try {
            apiCall { graph.api.delivery(id) }
        } catch (_: Exception) {
            null
        }
    }

    /** Linia oczekująca na skan lokalizacji (drugi skan). */
    var active by remember(id) { mutableStateOf<DeliveryLineView?>(null) }
    /** Kolizja EAN — operacja stoi, aż użytkownik wybierze (D7). */
    var conflict by remember(id) { mutableStateOf<List<EanCandidate>?>(null) }
    /** Rozjazd lokalizacji — pytamy PRZED zapisem, nigdy po (§4.3). */
    var mismatch by remember(id) { mutableStateOf<Pair<DeliveryLineView, String>?>(null) }
    /** Zgłoszenie wyjątku; `line` = null → problem całej dostawy (D8). */
    var problemFor by remember(id) { mutableStateOf<DeliveryLineView?>(null) }
    var problemOpen by remember(id) { mutableStateOf(false) }
    /** Typ wstępnie wybrany w arkuszu wyjątku (skrót „INNA ILOŚĆ"). */
    var problemType by remember(id) { mutableStateOf<ProblemType?>(null) }
    /** Zwroty: numer koszyka, z którego magazynier bierze towar (wpisany raz). */
    var koszyk by remember(id) { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }

    suspend fun resolveProduct(code: String) {
        try {
            when (val r = apiCall { graph.api.deliveryScan(id, ScanBody(code)) }) {
                is ScanResolution.Line -> {
                    graph.feedback.beep(true)
                    active = r.line
                }
                is ScanResolution.Conflict -> {
                    graph.feedback.beep(false)
                    conflict = r.candidates
                }
                is ScanResolution.OffDocument -> {
                    graph.feedback.beep(false)
                    graph.effects.toast("${r.sym} nie jest w tym dokumencie")
                }
                is ScanResolution.Locked -> {
                    // ktoś obok już bierze tę pozycję — idź dalej alejką
                    graph.feedback.beep(false)
                    graph.effects.toast("${r.sym} — pozycję rozkłada ${r.lockedBy}")
                }
                is ScanResolution.Unknown -> {
                    graph.feedback.beep(false)
                    graph.effects.toast("Nieznany kod: ${r.code}")
                }
            }
        } catch (e: Exception) {
            graph.effects.toast(e.message ?: "Błąd skanu")
        }
    }

    /** Zapis linii (bez MM). `locAction` = null na ścieżce bez rozjazdu. */
    suspend fun commitPutaway(line: DeliveryLineView, code: String, locAction: LocApplyAction?) {
        if (busy) return
        busy = true
        try {
            apiCall {
                graph.api.deliveryPutaway(
                    id,
                    line.id,
                    PutawayLineBody(code, locAction = locAction, koszyk = koszyk.trim().ifEmpty { null }),
                )
            }
            graph.feedback.beep(true)
            active = null
            mismatch = null
            reload++
            graph.queueRepo.refreshNow()
            graph.effects.flashSuccess("$code · ${line.sym}")
        } catch (e: Exception) {
            graph.feedback.beep(false)
            graph.effects.toast(e.message ?: "Błąd zapisu")
        } finally {
            busy = false
        }
    }

    /**
     * Drugi skan: lokalizacja. Gdy zeskanowana półka nie zgadza się z kartoteką,
     * zapis CZEKA na decyzję człowieka — serwer nie zgadnie, czy towar
     * przeniesiono, czy leży teraz w dwóch miejscach (§4.3).
     */
    /**
     * Koszyk opróżniony → jeden MM Zwroty→MAG na wszystko, co z niego poszło
     * na półki. Wciska to człowiek, bo tylko on widzi, że koszyk jest pusty.
     */
    suspend fun closeKoszyk(numer: String) {
        if (busy) return
        busy = true
        try {
            val r = apiCall { graph.api.closeBasket(id, numer) }
            graph.feedback.beep(true)
            reload++
            graph.queueRepo.refreshNow()
            graph.effects.flashSuccess("KOSZYK $numer → MM · ${formatQty(r.qty)} szt")
        } catch (e: Exception) {
            graph.feedback.beep(false)
            graph.effects.toast(e.message ?: "Nie udało się zamknąć koszyka")
        } finally {
            busy = false
        }
    }

    suspend fun putaway(line: DeliveryLineView, code: String) {
        val expected = line.locExpected
        if (!expected.isNullOrBlank() && expected != code) {
            graph.feedback.beep(false)
            mismatch = line to code
            return
        }
        commitPutaway(line, code, locAction = null)
    }

    // router skanów: gdy czekamy na lokalizację — LOC kończy operację;
    // w innym wypadku każdy skan próbuje rozstrzygnąć towar.
    // Przy otwartym pytaniu (rozjazd / wyjątek) skan jest połykany — decyzja
    // człowieka nie może zostać przewinięta przez przypadkowy strzał skanera.
    ScanHandlerEffect { scan ->
        if (mismatch != null || problemOpen) return@ScanHandlerEffect true
        // Przy zwrocie numer koszyka jest częścią każdego odłożenia. Zatrzymujemy
        // na PIERWSZYM skanie, a nie dopiero na zapisie: inaczej magazynier
        // zeskanowałby towar i półkę, żeby usłyszeć „podaj numer koszyka".
        if (view?.zwrot == true && koszyk.isBlank()) {
            graph.feedback.beep(false)
            graph.effects.toast("Najpierw wpisz numer koszyka")
            return@ScanHandlerEffect true
        }
        val line = active
        if (line != null && scan.kind != ScanKind.EAN) {
            scope.launch { putaway(line, normalizeLoc(scan.code)) }
        } else {
            scope.launch { resolveProduct(scan.code) }
        }
        true
    }

    val v = view
    if (v == null) {
        LoadingRow("Wczytywanie dostawy…")
        return
    }

    // zgłoszenie wyjątku przykrywa wszystko — magazynier już zdecydował, że
    // rutyna tu nie działa
    if (problemOpen) {
        ProblemSheet(
            graph = graph,
            deliveryId = id,
            line = problemFor,
            initialType = problemType,
            onDone = {
                problemOpen = false
                problemFor = null
                problemType = null
                active = null
                reload++
            },
            onCancel = {
                problemOpen = false
                problemFor = null
                problemType = null
            },
        )
        return
    }

    // rozjazd lokalizacji — zapis czeka na decyzję (§4.3)
    mismatch?.let { (line, code) ->
        MismatchSheet(
            sym = line.sym,
            expected = line.locExpected ?: "—",
            scanned = code,
            onPick = { action -> scope.launch { commitPutaway(line, code, action) } },
            onCancel = { mismatch = null },
        )
        return
    }

    // ekran kolizji EAN ma pierwszeństwo — operacja stoi
    conflict?.let { candidates ->
        EanConflictSheet(
            candidates = candidates,
            onPick = { c ->
                conflict = null
                scope.launch { resolveProduct(c.sym) } // symbol jest jednoznaczny
            },
            onCancel = { conflict = null },
        )
        return
    }

    // karta odkładania (po pierwszym skanie) — wielkie cyfry, czytelne z ramienia
    active?.let { line ->
        PutawayCard(
            line = line,
            onProblem = {
                problemFor = line
                problemOpen = true
            },
            onQtyIssue = {
                problemFor = line
                problemType = ProblemType.QTY_SHORT
                problemOpen = true
            },
            onCancel = {
                active = null
                // oddaj linię od razu, zamiast trzymać ją do wygaśnięcia TTL
                scope.launch { runCatching { apiCall { graph.api.releaseLine(id, line.id) } } }
            },
        )
        return
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        // nagłówek dostawy + postęp
        Column(Modifier.fillMaxWidth().cardSurface().padding(horizontal = 12.dp, vertical = 10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(v.nrPelny, fontFamily = BarlowCond, fontWeight = FontWeight.Bold, fontSize = 16.sp, color = Ink)
                FlagBadge(v.flaga, v.flagaKey)
            }
            Text(v.dostawca, fontSize = 12.sp, color = InkSoft, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Row(
                modifier = Modifier.fillMaxWidth().padding(top = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Box(
                    Modifier.weight(1f).height(6.dp).clip(RoundedCornerShape(50)).background(CardBorder),
                ) {
                    val frac = if (v.progress.total > 0) v.progress.done.toFloat() / v.progress.total else 0f
                    Box(
                        Modifier.fillMaxWidth(frac).height(6.dp).clip(RoundedCornerShape(50))
                            .background(if (v.progress.remaining == 0) Success else Amber),
                    )
                }
                Text(
                    "${v.progress.done}/${v.progress.total}",
                    fontFamily = BarlowCond,
                    fontWeight = FontWeight.ExtraBold,
                    fontSize = 15.sp,
                    color = if (v.progress.remaining == 0) Success else Ink,
                )
            }
            // wyjątki na tej dostawie nie mają prawa zniknąć z oczu (D8)
            if (v.progress.problems > 0) {
                Text(
                    "${v.progress.problems} ${if (v.progress.problems == 1) "pozycja z problemem" else "pozycje z problemem"}",
                    fontSize = 11.5.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = Destructive,
                    modifier = Modifier.padding(top = 4.dp),
                )
            }
        }

        if (v.zwrot) {
            KoszykBar(
                koszyk = koszyk,
                onKoszykChange = { koszyk = it },
                otwarte = v.koszyki,
                busy = busy,
                onClose = { numer -> scope.launch { closeKoszyk(numer) } },
            )
        }

        Text(
            if (v.zwrot) "Zeskanuj towar z koszyka — lista jest ułożona wg alejek"
            else "Zeskanuj towar z palety — lista jest ułożona wg alejek",
            fontSize = 12.sp,
            color = InkSoft,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth(),
        )

        // problem całej dostawy (np. nieznany kod na palecie, brak miejsca)
        OutlineButton(
            "ZGŁOŚ PROBLEM DOSTAWY",
            modifier = Modifier.fillMaxWidth(),
            leadingIcon = WIcons.Alert,
            onClick = {
                problemFor = null
                problemOpen = true
            },
        )

        val withLoc = v.lines.filter { it.locExpected != null }
        val withoutLoc = v.lines.filter { it.locExpected == null }

        // sekcje per alejka — magazynier wie, kiedy zmienia korytarz
        var lastAisle: String? = null
        withLoc.forEach { line ->
            if (line.aisle != lastAisle) {
                lastAisle = line.aisle
                SectionLabel("Alejka ${line.aisle}")
            }
            LineRow(line) { scope.launch { resolveProduct(line.sym) } }
        }

        if (withoutLoc.isNotEmpty()) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                modifier = Modifier.padding(top = 6.dp),
            ) {
                Icon(WIcons.Alert, null, tint = AmberInk, modifier = Modifier.size(15.dp))
                Text(
                    "BEZ LOKALIZACJI (${withoutLoc.size})",
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Bold,
                    letterSpacing = 1.1.sp,
                    color = AmberInk,
                )
            }
            withoutLoc.forEach { line -> LineRow(line) { scope.launch { resolveProduct(line.sym) } } }
        }
    }
}

/**
 * Pasek koszyka (tylko zwroty): numer bieżącego koszyka + przyciski domknięcia
 * KAŻDEGO koszyka, który ma coś na półkach, a nie ma jeszcze MM.
 *
 * Lista otwartych koszyków jest tu ważniejsza od samego pola: zapomniany koszyk
 * to towar leżący na półce i jednocześnie niesprzedawalny w Subiekcie — awaria
 * bez żadnego objawu, dopóki ktoś nie zapyta „gdzie to jest".
 */
@Composable
private fun KoszykBar(
    koszyk: String,
    onKoszykChange: (String) -> Unit,
    otwarte: List<KoszykView>,
    busy: Boolean,
    onClose: (String) -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .cardSurface(background = AmberBgSoft, borderColor = AmberLine)
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(
            "KOSZYK ZWROTU",
            fontSize = 11.sp,
            fontWeight = FontWeight.Bold,
            letterSpacing = 1.2.sp,
            color = AmberInk,
        )
        WertisTextField(
            value = koszyk,
            onValueChange = { onKoszykChange(it.trim()) },
            placeholder = "numer zwrotu z koszyka",
            keyboardType = KeyboardType.Number,
            leadingIcon = WIcons.Box,
        )
        otwarte.forEach { k ->
            OutlineButton(
                "KOSZYK ${k.numer} ROZŁOŻONY → MM  (${formatQty(k.qty)} szt)",
                modifier = Modifier.fillMaxWidth(),
                enabled = !busy,
                leadingIcon = WIcons.Check,
                onClick = { onClose(k.numer) },
            )
        }
    }
}

@Composable
private fun LineRow(line: DeliveryLineView, onClick: () -> Unit) {
    val done = line.status == "done" || line.status == "skipped"
    val problem = line.status == "problem"
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .cardSurface()
            .heightIn(min = 52.dp)
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Icon(
            when {
                problem -> WIcons.Alert
                done -> WIcons.Check
                else -> WIcons.Box
            },
            contentDescription = null,
            tint = when {
                problem -> Destructive
                done -> Success
                else -> InkMute
            },
            modifier = Modifier.size(18.dp),
        )
        Column(Modifier.weight(1f)) {
            Text(
                line.sym,
                fontFamily = BarlowCond,
                fontWeight = FontWeight.Bold,
                fontSize = 15.sp,
                color = if (done) InkMute else Ink,
            )
            Text(line.name, fontSize = 12.sp, color = InkSoft, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(
                if (problem) {
                    "ZGŁOSZONY PROBLEM · ${formatQty(line.qtyDoc)} szt"
                } else {
                    "${line.locExpected ?: "—"} · ${formatQty(line.qtyDoc)} szt" +
                        if (line.status == "partial") " · odłożono ${formatQty(line.qtyDone)}" else ""
                },
                fontSize = 11.sp,
                fontWeight = if (problem) FontWeight.Bold else FontWeight.Normal,
                color = when {
                    problem -> Destructive
                    line.locExpected == null -> AmberInk
                    else -> InkMute
                },
            )
        }
    }
}

/** Karta po pierwszym skanie: ilość i lokalizacja czytelne z odległości ramienia. */
@Composable
private fun PutawayCard(
    line: DeliveryLineView,
    onProblem: () -> Unit,
    onQtyIssue: () -> Unit,
    onCancel: () -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxSize().padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(line.sym, fontFamily = BarlowCond, fontWeight = FontWeight.ExtraBold, fontSize = 22.sp, color = Ink)
        Text(line.name, fontSize = 13.sp, color = InkSoft, maxLines = 2)

        Column(
            modifier = Modifier
                .fillMaxWidth()
                .cardSurface(background = AmberBgSoft, borderColor = AmberLine)
                .padding(vertical = 18.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Text(
                "${formatQty(line.qtyDoc - line.qtyDone)} szt",
                fontFamily = BarlowCond,
                fontWeight = FontWeight.ExtraBold,
                fontSize = 46.sp,
                color = Ink,
            )
            Text(
                "→ ${line.locExpected ?: "BRAK LOKALIZACJI"}",
                fontFamily = BarlowCond,
                fontWeight = FontWeight.Bold,
                fontSize = 30.sp,
                color = AmberInk,
            )
        }

        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Icon(WIcons.Pin, null, tint = InkSoft, modifier = Modifier.size(18.dp))
            Text(
                "zeskanuj etykietę lokalizacji",
                fontSize = 14.sp,
                fontWeight = FontWeight.SemiBold,
                color = InkSoft,
            )
        }

        // Rozkładanie JEST sprawdzaniem faktury i liczy się KAŻDĄ pozycję, więc
        // rozbieżność ilościowa to najczęstszy wyjątek — zasługuje na własny
        // przycisk, a nie na szukanie kafla wśród siedmiu typów.
        OutlineButton(
            "INNA ILOŚĆ",
            modifier = Modifier.fillMaxWidth(),
            leadingIcon = WIcons.Alert,
            onClick = onQtyIssue,
        )
        // pozostałe wyjścia awaryjne: uszkodzone, zły towar, brak miejsca (§4.6)
        OutlineButton(
            "PROBLEM",
            modifier = Modifier.fillMaxWidth(),
            danger = true,
            leadingIcon = WIcons.Alert,
            onClick = onProblem,
        )
        OutlineButton("ANULUJ", modifier = Modifier.fillMaxWidth(), onClick = onCancel)
    }
}

/** Kolizja EAN — operacja stoi, aplikacja nigdy nie wybiera pierwszego (D7). */
@Composable
private fun EanConflictSheet(
    candidates: List<EanCandidate>,
    onPick: (EanCandidate) -> Unit,
    onCancel: () -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Icon(WIcons.Alert, null, tint = Destructive, modifier = Modifier.size(20.dp))
            Text(
                "Kod wskazuje ${candidates.size} towary",
                fontFamily = BarlowCond,
                fontWeight = FontWeight.Bold,
                fontSize = 18.sp,
                color = Ink,
            )
        }
        Text("Wybierz właściwy — aplikacja nie zgaduje.", fontSize = 13.sp, color = InkSoft)

        candidates.forEach { c ->
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .cardSurface(
                        background = if (c.inDocument) AmberBg else CardWhite,
                        borderColor = if (c.inDocument) AmberLine else CardBorder,
                    )
                    .clickable { onPick(c) }
                    .padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                Text(c.sym, fontFamily = BarlowCond, fontWeight = FontWeight.Bold, fontSize = 16.sp, color = Ink)
                Text(c.name, fontSize = 12.5.sp, color = InkSoft, maxLines = 2)
                Text(
                    if (c.inDocument) {
                        "w dokumencie: ${formatQty(c.qtyDoc ?: 0.0)} szt → ${c.locExpected ?: "—"}"
                    } else {
                        "spoza dokumentu → ${c.locExpected ?: "—"}"
                    },
                    fontSize = 11.5.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = if (c.inDocument) AmberInk else InkMute,
                )
            }
        }

        OutlineButton("ANULUJ", modifier = Modifier.fillMaxWidth(), onClick = onCancel)
    }
}
