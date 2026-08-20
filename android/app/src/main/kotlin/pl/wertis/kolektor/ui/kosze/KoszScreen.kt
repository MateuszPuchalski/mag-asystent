package pl.wertis.kolektor.ui.kosze

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
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
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import pl.wertis.kolektor.AppGraph
import pl.wertis.kolektor.core.loc.normalizeLoc
import pl.wertis.kolektor.core.net.KoszPozycja
import pl.wertis.kolektor.core.net.KoszView
import pl.wertis.kolektor.core.net.OdlozKoszBody
import pl.wertis.kolektor.core.net.ScanBody
import pl.wertis.kolektor.core.scan.ScanKind
import pl.wertis.kolektor.net.apiCall
import pl.wertis.kolektor.scan.ScanHandlerEffect
import pl.wertis.kolektor.ui.components.LoadingRow
import pl.wertis.kolektor.ui.components.PrimaryButton
import pl.wertis.kolektor.ui.components.WIcons
import pl.wertis.kolektor.ui.components.WertisTextField
import pl.wertis.kolektor.ui.theme.Amber
import pl.wertis.kolektor.ui.theme.AmberBg
import pl.wertis.kolektor.ui.theme.BarlowCond
import pl.wertis.kolektor.ui.theme.Ink
import pl.wertis.kolektor.ui.theme.InkMute
import pl.wertis.kolektor.ui.theme.InkSoft
import pl.wertis.kolektor.ui.theme.Success
import pl.wertis.kolektor.ui.theme.cardSurface

/* ── Rozkładanie kosza zwrotowego (Etap 3 zwrotów Allegro) ───────────────────
   Ta sama gramatyka skanu co przy dostawach, bo ręce już ją znają:

     skan TOWARU  → wskazuje pozycję kosza (serwer szuka wyłącznie w koszu —
                    cudzy towar dostaje uczciwe „nie z tego kosza"),
     skan REGAŁU  → odkłada wskazaną pozycję pod ten adres.

   Po ostatniej pozycji zostaje jeden przycisk: ZAKOŃCZ. To on cofa bufor —
   serwer kolejkuje MM ZWROTY→MAG per pozycja i nikt przy komputerze niczego
   nie pilnuje. Ekran świadomie NIE ma korekt ilości ani wyjątków: ilości
   rozstrzygnęła ocena zwrotu w biurze, a kosz tylko je roznosi.              */

@Composable
fun KoszScreen(graph: AppGraph) {
    val id = graph.nav.koszId ?: return
    val scope = rememberCoroutineScope()
    var reload by remember { mutableStateOf(0) }
    var kosz by remember { mutableStateOf<KoszView?>(null) }
    var wybrana by remember { mutableStateOf<Long?>(null) }
    var adres by remember { mutableStateOf("") }

    fun wybierz(p: KoszPozycja?) {
        wybrana = p?.id
        adres = p?.lokOczekiwana ?: ""
    }

    LaunchedEffect(id, reload) {
        try {
            val k = apiCall { graph.api.kosz(id) }.kosz
            kosz = k
            // domyślnie wskazana pierwsza nieodłożona — lista jest alejkowa,
            // więc to zarazem najbliższy regał na trasie
            if (wybrana == null || k.pozycje.none { it.id == wybrana && it.status == "todo" }) {
                wybierz(k.pozycje.firstOrNull { it.status == "todo" })
            }
        } catch (e: Exception) {
            graph.effects.toast(e.message ?: "Nie udało się wczytać kosza")
        }
    }

    fun odloz(pozycjaId: Long, kod: String, recznie: Boolean) {
        scope.launch {
            try {
                apiCall { graph.api.koszOdloz(pozycjaId, OdlozKoszBody(kod, recznie)) }
                graph.feedback.beep(true)
                reload++
            } catch (e: Exception) {
                graph.feedback.beep(false)
                graph.effects.toast(e.message ?: "Nie udało się odłożyć")
            }
        }
    }

    fun skanTowaru(code: String) {
        scope.launch {
            try {
                val r = apiCall { graph.api.koszSkan(id, ScanBody(code)) }
                when {
                    r.pozycjaId != null -> {
                        graph.feedback.beep(true)
                        wybierz(kosz?.pozycje?.firstOrNull { it.id == r.pozycjaId })
                    }
                    r.poza -> {
                        graph.feedback.beep(false)
                        graph.effects.toast("${r.symbol} nie jest z tego kosza")
                    }
                    else -> {
                        graph.feedback.beep(false)
                        graph.effects.toast("Nieznany kod: $code")
                    }
                }
            } catch (e: Exception) {
                graph.effects.toast(e.message ?: "Błąd połączenia z serwerem")
            }
        }
    }

    ScanHandlerEffect { scan ->
        val k = kosz ?: return@ScanHandlerEffect true
        if (k.status != "zamkniety") return@ScanHandlerEffect true
        val sel = wybrana
        if (sel != null && scan.kind != ScanKind.EAN) {
            odloz(sel, normalizeLoc(scan.code), recznie = false)
        } else {
            skanTowaru(scan.code)
        }
        true
    }

    val k = kosz
    if (k == null) {
        LoadingRow("Wczytywanie kosza…")
        return
    }
    val doZrobienia = k.pozycje.count { it.status == "todo" }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(
            "KOSZ ${k.kod} · ODŁOŻONE ${k.pozycje.size - doZrobienia}/${k.pozycje.size}",
            fontSize = 11.sp,
            fontWeight = FontWeight.Bold,
            letterSpacing = 1.2.sp,
            color = InkSoft,
        )
        k.pozycje.forEach { p ->
            PozycjaRow(p, selected = p.id == wybrana) { if (p.status == "todo") wybierz(p) }
        }

        val sel = k.pozycje.firstOrNull { it.id == wybrana }
        if (sel != null && k.status == "zamkniety") {
            Text(
                "ODŁÓŻ: ${sel.symbol.ifEmpty { sel.nazwa }} — skanuj regał albo wpisz adres",
                fontSize = 12.sp,
                color = InkMute,
            )
            WertisTextField(
                value = adres,
                onValueChange = { adres = it },
                placeholder = "np. A01-02-03",
                leadingIcon = WIcons.Scan,
                onDone = { if (adres.isNotBlank()) odloz(sel.id, normalizeLoc(adres), recznie = true) },
            )
            PrimaryButton("ODŁÓŻ TUTAJ", enabled = adres.isNotBlank(), modifier = Modifier.fillMaxWidth()) {
                odloz(sel.id, normalizeLoc(adres), recznie = true)
            }
        }

        if (doZrobienia == 0 && k.status == "zamkniety") {
            PrimaryButton("ZAKOŃCZ — COFNIJ BUFOR", tall = true, modifier = Modifier.fillMaxWidth()) {
                scope.launch {
                    try {
                        apiCall { graph.api.koszZakoncz(id) }
                        graph.effects.toast("Kosz rozłożony — MM na magazyn główny w kolejce")
                        graph.nav.zakonczonyKosz()
                    } catch (e: Exception) {
                        graph.effects.toast(e.message ?: "Nie udało się zakończyć")
                    }
                }
            }
        }
        if (k.status == "rozlozony") {
            Text("Kosz rozłożony — bufor cofnięty automatycznie.", fontSize = 13.sp, color = InkMute)
        }
    }
}

@Composable
private fun PozycjaRow(p: KoszPozycja, selected: Boolean, onClick: () -> Unit) {
    val done = p.status == "done"
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .cardSurface()
            .then(if (selected) Modifier.border(2.dp, Amber, RoundedCornerShape(12.dp)) else Modifier)
            .heightIn(min = 56.dp)
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Box(
            modifier = Modifier
                .size(40.dp)
                .clip(RoundedCornerShape(10.dp))
                .background(if (done) Success.copy(alpha = 0.15f) else AmberBg),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                if (done) WIcons.Check else WIcons.Box,
                contentDescription = null,
                tint = if (done) Success else Ink,
                modifier = Modifier.size(22.dp),
            )
        }
        Column(Modifier.weight(1f)) {
            Text(p.symbol.ifEmpty { p.nazwa }, fontFamily = BarlowCond, fontWeight = FontWeight.Bold, fontSize = 17.sp, color = Ink)
            Text(p.nazwa, fontSize = 12.sp, color = InkMute, maxLines = 1)
        }
        Column(horizontalAlignment = Alignment.End) {
            Text("${p.ilosc.toInt()} szt.", fontSize = 14.sp, fontWeight = FontWeight.Bold, color = Ink)
            /* Adres, pod który towar MA trafić — a po odłożeniu ten faktyczny.
               Brak adresu jest informacją, nie pustką: regał wybiera człowiek. */
            Text(
                p.lokFaktyczna ?: p.lokOczekiwana ?: "bez adresu",
                fontSize = 13.sp,
                color = if (done) Success else InkSoft,
                fontWeight = FontWeight.SemiBold,
            )
        }
    }
}
