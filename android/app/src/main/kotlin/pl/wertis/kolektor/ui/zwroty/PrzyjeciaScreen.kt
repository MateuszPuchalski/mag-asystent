package pl.wertis.kolektor.ui.zwroty

import androidx.compose.foundation.background
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
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import pl.wertis.kolektor.AppGraph
import pl.wertis.kolektor.core.net.KoszRow
import pl.wertis.kolektor.core.net.OtworzPrzyjecieBody
import pl.wertis.kolektor.core.net.PrzyjecieRow
import pl.wertis.kolektor.net.apiCall
import pl.wertis.kolektor.scan.ScanHandlerEffect
import pl.wertis.kolektor.ui.components.LoadingRow
import pl.wertis.kolektor.ui.components.OutlineButton
import pl.wertis.kolektor.ui.components.WertisTextField
import pl.wertis.kolektor.ui.components.WIcons
import pl.wertis.kolektor.ui.theme.Amber
import pl.wertis.kolektor.ui.theme.AmberBg
import pl.wertis.kolektor.ui.theme.AmberInk
import pl.wertis.kolektor.ui.theme.BarlowCond
import pl.wertis.kolektor.ui.theme.Ink
import pl.wertis.kolektor.ui.theme.InkMute
import pl.wertis.kolektor.ui.theme.InkSoft
import pl.wertis.kolektor.ui.theme.Success
import pl.wertis.kolektor.ui.theme.cardSurface

/* ── Zakładka ZWROTY: rozkładanie koszy z regału zwrotów ─────────────────────
   Kosz przyjeżdża z KARTKĄ, na której ktoś w biurze napisał długopisem numer
   przesunięcia MM z Subiekta („1209"). Ten numer jest tu jednostką pracy:
   pole u góry przyjmuje go ze skanera i z klawiatury, a lista niżej pokazuje
   przyjęcia, które aplikacja zna z importu.

   Czego ten ekran NIE robi: nie wystawia żadnego dokumentu. Przesunięcie na
   regał zwrotów zrobiło biuro przed przywiezieniem kosza, a powrotne
   (ZWR→MAG) zrobi biuro po rozłożeniu. Kolektor zapisuje adresy i tyle.

   Pod przyjęciami stoi druga sekcja: kosze SKŁADANE W APLIKACJI (Etap 3
   zwrotów Allegro). Dwa obiegi obok siebie są świadomą decyzją właściciela —
   ten z dokumentem jest codzienną robotą, tamten obsługuje zwroty prowadzone
   w całości przez WERTIS.                                                    */

@Composable
fun PrzyjeciaScreen(graph: AppGraph) {
    val scope = rememberCoroutineScope()
    var reload by remember { mutableStateOf(0) }
    var szukanie by rememberSaveable { mutableStateOf("") }

    val przyjecia by produceState<List<PrzyjecieRow>?>(null, reload) {
        value = try {
            apiCall { graph.api.przyjecia() }.przyjecia
        } catch (_: Exception) {
            value ?: emptyList()
        }
    }

    /* Kosze z aplikacji dociągane OBOK przyjęć, nie w jednej odpowiedzi: to
       inna domena i inny rytm — awaria jednej listy nie ma zabierać drugiej. */
    val kosze by produceState(emptyList<KoszRow>(), reload) {
        value = try {
            apiCall { graph.api.kosze() }.kosze
        } catch (_: Exception) {
            value
        }
    }

    fun otworz(numer: String) {
        val czysty = numer.trim()
        if (czysty.isEmpty()) return
        scope.launch {
            try {
                val r = apiCall { graph.api.przyjecieOtworz(OtworzPrzyjecieBody(czysty)) }
                szukanie = ""
                graph.nav.openKosz(r.kosz.id)
            } catch (e: Exception) {
                graph.effects.toast(e.message ?: "Nie znam takiego przyjęcia")
            }
        }
    }

    /* Skaner jest tu tą samą drogą co klawiatura: kartki bywają drukowane
       z kodem, a bywają pisane ręką. Cokolwiek przyjdzie — szuka przyjęcia. */
    ScanHandlerEffect { scan ->
        otworz(scan.code)
        true
    }

    val lista = przyjecia
    if (lista == null) {
        LoadingRow("Wczytywanie przyjęć…")
        return
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(
            "NUMER Z KARTKI PRZY KOSZU",
            fontSize = 11.sp,
            fontWeight = FontWeight.Bold,
            letterSpacing = 1.2.sp,
            color = InkSoft,
        )
        WertisTextField(
            value = szukanie,
            onValueChange = { szukanie = it },
            placeholder = "np. 1209",
            leadingIcon = WIcons.Search,
            onDone = { otworz(szukanie) },
        )

        Text(
            "PRZYJĘCIA NA REGAŁ ZWROTÓW",
            fontSize = 11.sp,
            fontWeight = FontWeight.Bold,
            letterSpacing = 1.2.sp,
            color = InkSoft,
        )
        if (lista.isEmpty()) {
            Text(
                "Brak przyjęć w oknie importu. Kosz z kartką otworzysz numerem powyżej.",
                fontSize = 13.sp,
                color = InkMute,
            )
        }
        lista.forEach { p -> PrzyjecieRowView(p) { otworz(p.numer) } }

        if (kosze.isNotEmpty()) {
            Text(
                "KOSZE Z APLIKACJI · DO ROZŁOŻENIA",
                fontSize = 11.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = 1.2.sp,
                color = InkSoft,
            )
            kosze.forEach { k -> KoszRowView(k) { graph.nav.openKosz(k.id) } }
        }

        /* Odświeżenie ręką: import z Subiekta chodzi co minutę, a magazynier
           stojący z nowym koszem nie ma ochoty czekać w niewiedzy. */
        OutlineButton("ODŚWIEŻ LISTĘ") { reload++ }
    }
}

@Composable
private fun PrzyjecieRowView(p: PrzyjecieRow, onClick: () -> Unit) {
    val zrobione = p.stan == "rozlozony" || p.stan == "poza_aplikacja"
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .cardSurface()
            .heightIn(min = 56.dp)
            .clickable(enabled = !zrobione, onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Box(
            modifier = Modifier
                .size(40.dp)
                .clip(RoundedCornerShape(10.dp))
                .background(if (zrobione) AmberBg.copy(alpha = 0.4f) else AmberBg),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                WIcons.Box,
                contentDescription = null,
                tint = if (zrobione) InkMute else AmberInk,
                modifier = Modifier.size(22.dp),
            )
        }
        Column(Modifier.weight(1f)) {
            Text(
                "KOSZ ${p.numer}",
                fontFamily = BarlowCond,
                fontWeight = FontWeight.Bold,
                fontSize = 17.sp,
                color = if (zrobione) InkMute else Ink,
            )
            Text(
                "${p.data} · ${p.pozycji} poz.",
                fontSize = 12.sp,
                color = InkMute,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        Text(
            opisStanu(p),
            fontSize = 13.sp,
            fontWeight = if (p.stan == "w_rozkladaniu") FontWeight.Bold else FontWeight.Normal,
            color = when (p.stan) {
                "rozlozony" -> Success
                "w_rozkladaniu" -> Amber
                else -> InkSoft
            },
        )
    }
}

/** Krótkie zdanie po prawej stronie wiersza — stan pracy, nie stan dokumentu. */
private fun opisStanu(p: PrzyjecieRow): String = when (p.stan) {
    "rozlozony" -> "ROZŁOŻONY"
    "poza_aplikacja" -> "poza aplikacją"
    "w_rozkladaniu" -> "${p.odlozonych}/${p.pozycji} poz."
    else -> "do rozłożenia"
}

@Composable
private fun KoszRowView(k: KoszRow, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .cardSurface()
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
                .background(AmberBg),
            contentAlignment = Alignment.Center,
        ) {
            Icon(WIcons.Box, contentDescription = null, tint = AmberInk, modifier = Modifier.size(22.dp))
        }
        Column(Modifier.weight(1f)) {
            Text("KOSZ ${k.kod}", fontFamily = BarlowCond, fontWeight = FontWeight.Bold, fontSize = 17.sp, color = Ink)
            Text(
                "zwroty Allegro · ${k.zwrotow} zwr.",
                fontSize = 12.sp,
                color = InkMute,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        Text("${k.odlozonych}/${k.pozycji} poz.", fontSize = 13.sp, color = InkSoft)
    }
}
